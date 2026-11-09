package dev.jarvis.companion

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.AudioAttributes
import android.media.AudioManager
import android.media.MediaPlayer
import android.os.Build
import android.os.IBinder
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.util.Locale
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

/**
 * Toca a fala. Duas formas, a mesma da macro Falar:
 *  - audio_url: áudio sintetizado na nuvem (baixado do Drive), tocado por MediaPlayer;
 *  - texto + local: voz do próprio celular (TextToSpeech).
 *
 * CANAL DE ALARME, de propósito: medido por ADB em 28/09, o canal de música cai numa saída DIRECT do Android, fora do
 * mixer onde o Xiaomi aplica o reforço do alto-falante, e fica quase inaudível. O alarme usa o mixer e sai alto (e toca
 * mesmo no silencioso). Como o alarme tem volume próprio, ele é igualado ao da mídia durante a fala e depois restaurado.
 *
 * Uma fala por vez: ordens que chegam juntas esperam a anterior acabar (fila de uma thread só).
 */
class FalaService : Service() {
    companion object {
        const val LIMITE_CURTA = 160        // até aqui a resposta da conversa sai pela voz do celular
        const val PITCH_JARVIS = 0.88f      // 1.0 é o normal; mais grave que a voz padrão
        const val RITMO_JARVIS = 0.95f
    }

    private val fila = Executors.newSingleThreadExecutor()
    private val pendentes = AtomicInteger(0)

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        iniciarEmPrimeiroPlano()
        val i = intent ?: run { stopSelf(); return START_NOT_STICKY }
        pendentes.incrementAndGet()
        fila.execute {
            try { tocar(i) } finally { if (pendentes.decrementAndGet() == 0) stopSelf() }
        }
        return START_NOT_STICKY
    }

    private fun iniciarEmPrimeiroPlano() {
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.createNotificationChannel(NotificationChannel("fala", "Fala do Jarvis", NotificationManager.IMPORTANCE_LOW))
        val n = Notification.Builder(this, "fala")
            .setSmallIcon(android.R.drawable.ic_lock_silent_mode_off)
            .setContentTitle("Jarvis falando")
            .build()
        if (Build.VERSION.SDK_INT >= 29) startForeground(1, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK)
        else startForeground(1, n)
    }

    private val atributos: AudioAttributes = AudioAttributes.Builder()
        .setUsage(AudioAttributes.USAGE_ALARM)
        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
        .build()

    private fun tocar(i: Intent) {
        val id = i.getStringExtra("id") ?: return
        var texto = i.getStringExtra("texto") ?: ""
        val audioUrl = i.getStringExtra("audio_url") ?: ""
        // Conversa por toque: pergunta ao Jarvis e fala a resposta pelo celular. Sem ack: não há ordem do servidor a confirmar.
        val pergunta = i.getStringExtra("pergunta")
        if (pergunta != null) {
            val t0 = System.currentTimeMillis()
            texto = Conversa.perguntar(this, pergunta, i.getStringExtra("rid") ?: id.removePrefix("c"))
            Config.evento(this, "conversa: resposta de ${texto.length} caracteres em ${(System.currentTimeMillis() - t0) / 1000} s")
            Config.estado(this).edit().putString("ultima_resposta", texto.take(600)).apply()
            // Voz do Jarvis: o servidor sintetiza e manda o áudio por push (toca depois que esta tarefa termina, a fila é de uma thread só).
            // Resposta curta (hora, saldo) sai na hora pela voz do celular, ajustada para soar como o Jarvis; a premium soma uns 13 s
            // de síntese e só vale a espera para respostas longas, que o dono para para ouvir (mesma regra do MacroDroid).
            if (Conversa.respostaReal && texto.length > LIMITE_CURTA && Conversa.vozPremium(this, texto)) {
                Config.evento(this, "conversa: voz do Jarvis pedida ao servidor")
                return
            }
            Config.evento(this, "conversa: falando pela voz do celular")
        }
        val local = i.getBooleanExtra("local", false) || pergunta != null
        val am = getSystemService(Context.AUDIO_SERVICE) as AudioManager
        val alarmeAntes = am.getStreamVolume(AudioManager.STREAM_ALARM)
        try {
            igualarVolumeDoAlarme(am)
            if (audioUrl.isNotBlank() && !local) {
                val arq = baixar(audioUrl, id)
                try {
                    AckQueue.enviar(this, id, "tocando")
                    tocarArquivo(arq)
                } finally { arq.delete() }
            } else if (texto.isNotBlank()) {
                if (pergunta == null) AckQueue.enviar(this, id, "tocando")
                falarComTts(texto)
            } else {
                throw IllegalStateException("ordem sem áudio e sem texto")
            }
            Config.evento(this, "fala concluída ($id)")
            if (pergunta == null) AckQueue.enviar(this, id, "concluido")
        } catch (e: Exception) {
            Config.evento(this, "fala falhou ($id): ${e.message}")
            if (pergunta == null) AckQueue.enviar(this, id, "erro", (e.message ?: e.javaClass.simpleName).take(150))
        } finally {
            try { am.setStreamVolume(AudioManager.STREAM_ALARM, alarmeAntes, 0) } catch (e: Exception) { }
        }
    }

    /** Falar v7 da macro: o volume do alarme acompanha o da mídia, para a fala não sair mais baixa nem mais alta que o resto. */
    private fun igualarVolumeDoAlarme(am: AudioManager) {
        try {
            val musica = am.getStreamVolume(AudioManager.STREAM_MUSIC).toFloat() / am.getStreamMaxVolume(AudioManager.STREAM_MUSIC)
            val alvo = Math.max(1, Math.round(musica * am.getStreamMaxVolume(AudioManager.STREAM_ALARM)))
            am.setStreamVolume(AudioManager.STREAM_ALARM, alvo, 0)
        } catch (e: Exception) { /* modo Não perturbe pode recusar; toca no volume atual */ }
    }

    /** Baixa o áudio do Drive. Recusa página HTML (link sem permissão devolve a tela de login, não áudio). */
    private fun baixar(url: String, id: String): File {
        val c = URL(url).openConnection() as HttpURLConnection
        c.connectTimeout = 15000; c.readTimeout = 30000; c.instanceFollowRedirects = true
        try {
            if (c.responseCode !in 200..299) throw IllegalStateException("download HTTP ${c.responseCode}")
            val tipo = (c.contentType ?: "").lowercase()
            if (tipo.startsWith("text/")) throw IllegalStateException("o link devolveu texto/HTML, não áudio")
            val arq = File(cacheDir, "fala-$id.bin")
            var total = 0L
            c.inputStream.use { ent -> arq.outputStream().use { sai ->
                val buf = ByteArray(16384)
                while (true) {
                    val n = ent.read(buf); if (n < 0) break
                    total += n; if (total > 40L * 1024 * 1024) throw IllegalStateException("áudio grande demais")
                    sai.write(buf, 0, n)
                }
            } }
            if (total < 200) throw IllegalStateException("áudio vazio ($total bytes)")
            return arq
        } finally { c.disconnect() }
    }

    private fun tocarArquivo(arq: File) {
        val fim = CountDownLatch(1)
        var erro: String? = null
        val mp = MediaPlayer()
        try {
            mp.setAudioAttributes(atributos)
            mp.setDataSource(arq.absolutePath)
            mp.setOnCompletionListener { fim.countDown() }
            mp.setOnErrorListener { _, what, extra -> erro = "MediaPlayer erro $what/$extra"; fim.countDown(); true }
            mp.prepare()
            mp.start()
            if (!fim.await(180, TimeUnit.SECONDS)) erro = "tempo esgotado tocando o áudio"
        } finally { try { mp.release() } catch (e: Exception) { } }
        erro?.let { throw IllegalStateException(it) }
    }

    /**
     * Aproxima a voz do celular da do Jarvis (Gemini "Iapetus": masculina, grave, séria). O Android não informa o gênero das vozes;
     * as do Google com sufixo "ptd" e "pte" em pt-BR são as masculinas, então entram primeiro. Grave um pouco (pitch) e fala um
     * pouco mais devagar, como o narrador. A voz escolhida fica registrada para conferir de ouvido e trocar se não agradar.
     */
    private fun ajustarVoz(t: TextToSpeech) {
        try {
            val ptbr = t.voices?.filter { it.locale.language == "pt" && it.locale.country == "BR" } ?: emptyList()
            val pedida = Config.estado(this).getString("voz_preferida", "") ?: ""
            val escolhida = (if (pedida.isNotBlank()) ptbr.firstOrNull { it.name == pedida } else null)
                ?: listOf("ptd", "pte").firstNotNullOfOrNull { s -> ptbr.firstOrNull { it.name.contains(s) } } ?: ptbr.firstOrNull()
            if (escolhida != null) {
                t.voice = escolhida
                val p = Config.estado(this)
                if (p.getString("voz_usada", "") != escolhida.name) {
                    p.edit().putString("voz_usada", escolhida.name).apply()
                    Config.evento(this, "voz do celular: ${escolhida.name} (disponíveis: ${ptbr.joinToString(",") { it.name }.take(120)})")
                }
            }
        } catch (e: Exception) { /* fica a voz padrão */ }
        val ajuste = Config.estado(this)
        t.setPitch(ajuste.getFloat("pitch", PITCH_JARVIS))
        t.setSpeechRate(ajuste.getFloat("ritmo", RITMO_JARVIS))
    }

    private fun falarComTts(texto: String) {
        val pronto = CountDownLatch(1)
        val fim = CountDownLatch(1)
        var erro: String? = null
        var tts: TextToSpeech? = null
        tts = TextToSpeech(this) { status ->
            if (status != TextToSpeech.SUCCESS) { erro = "TTS do celular não iniciou"; pronto.countDown(); return@TextToSpeech }
            pronto.countDown()
        }
        try {
            if (!pronto.await(10, TimeUnit.SECONDS)) throw IllegalStateException("TTS do celular não respondeu")
            erro?.let { throw IllegalStateException(it) }
            val t = tts!!
            t.language = Locale("pt", "BR")
            ajustarVoz(t)
            t.setAudioAttributes(atributos)
            t.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
                override fun onStart(u: String?) {}
                override fun onDone(u: String?) { fim.countDown() }
                @Deprecated("API antiga") override fun onError(u: String?) { erro = "erro no TTS"; fim.countDown() }
            })
            t.speak(texto, TextToSpeech.QUEUE_FLUSH, null, "fala")
            if (!fim.await(120, TimeUnit.SECONDS)) erro = "tempo esgotado falando"
        } finally { try { tts?.shutdown() } catch (e: Exception) { } }
        erro?.let { throw IllegalStateException(it) }
    }
}
