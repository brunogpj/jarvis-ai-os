package dev.jarvis.companion

import android.Manifest
import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.core.content.ContextCompat
import dev.jarvis.companion.ui.EstadoOuvindo
import dev.jarvis.companion.ui.Fase
import dev.jarvis.companion.ui.JarvisTema
import dev.jarvis.companion.ui.OuvindoTela

/**
 * Tela "Ouvindo" (0.12.0, Compose): reconhecimento de fala DENTRO do app, em pt-BR, com a frase aparecendo enquanto você fala. O orbe mostra em que pé
 * está a conversa: OUVINDO (cresce com o volume da voz), PENSANDO (arco girando enquanto o Jarvis responde) e FALANDO (pulsa e mostra a resposta). A
 * tela fica aberta até a fala acabar, em vez de fechar ao enviar. Aberta pelo orbe, pelo widget, pelo botão de energia (assistente) e pelo atalho.
 *
 * Precisa da permissão de microfone (pedida na primeira vez). Sem permissão, sem serviço de reconhecimento no aparelho ou com erro do
 * reconhecedor, cai na tela de reconhecimento do próprio Google (a da 0.3.x), que não exige permissão: o app nunca fica sem a conversa.
 */
class ConversaActivity : ComponentActivity() {
    private var reconhecedor: SpeechRecognizer? = null
    private val e = EstadoOuvindo()
    private var ultimaParcial = ""
    private var encerrada = false
    private val relogio = Handler(Looper.getMainLooper())

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge(statusBarStyle = SystemBarStyle.dark(Color.TRANSPARENT), navigationBarStyle = SystemBarStyle.dark(Color.TRANSPARENT))
        setContent { JarvisTema { OuvindoTela(e, aoParar = { reconhecedor?.stopListening(); e.dica = "Processando…" }, aoFechar = { cancelarTudo() }, aoRepetir = { UltimaFala.repetir(this) }) } }
        if (intent.getBooleanExtra("demo", false)) { demonstrar(intent.getStringExtra("fase")); return }
        Config.evento(this, "ouvindo: tela aberta (microfone ${if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) "liberado" else "sem permissão"})")
        if (!SpeechRecognizer.isRecognitionAvailable(this)) { usarTelaDoSistema("sem serviço de reconhecimento"); return }
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) comecar()
        else requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), 11)
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == 11) {
            if (grantResults.isNotEmpty() && grantResults[0] == PackageManager.PERMISSION_GRANTED) comecar()
            else usarTelaDoSistema("microfone negado")
        }
    }

    private fun comecar() {
        val r = SpeechRecognizer.createSpeechRecognizer(this)
        reconhecedor = r
        r.setRecognitionListener(object : RecognitionListener {
            override fun onReadyForSpeech(params: Bundle?) { Config.evento(this@ConversaActivity, "ouvindo: reconhecedor pronto"); e.dica = "Fale agora." }
            override fun onBeginningOfSpeech() { Config.evento(this@ConversaActivity, "ouvindo: começou a captar voz"); e.dica = "Fale normalmente. Toque no quadrado quando terminar." }
            override fun onRmsChanged(rmsdB: Float) { e.empurrar((rmsdB + 2f) / 12f) }       // -2..10 dB → 0..1
            override fun onBufferReceived(buffer: ByteArray?) {}
            override fun onEndOfSpeech() { Config.evento(this@ConversaActivity, "ouvindo: fim da fala"); e.dica = "Processando…" }
            override fun onPartialResults(partialResults: Bundle?) {
                val t = partialResults?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull() ?: return
                if (t.isNotBlank()) { ultimaParcial = t; e.frase = t }
            }
            override fun onResults(results: Bundle?) {
                val t = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()?.trim().orEmpty()
                Config.evento(this@ConversaActivity, "ouvindo: resultado de ${t.length} caracteres")
                enviar(if (t.isNotBlank()) t else ultimaParcial)
            }
            override fun onError(error: Int) {
                Config.evento(this@ConversaActivity, "ouvindo: erro $error do reconhecedor" + if (encerrada) " (já encerrada)" else "")
                if (encerrada) return
                if (error == SpeechRecognizer.ERROR_NO_MATCH || error == SpeechRecognizer.ERROR_SPEECH_TIMEOUT) {
                    if (ultimaParcial.isNotBlank()) { enviar(ultimaParcial); return }
                    e.fase = Fase.NADA; e.dica = "Toque em Cancelar e tente de novo."
                    relogio.postDelayed({ if (!encerrada) cancelarTudo() }, 1500)
                    return
                }
                if (error == SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS) { usarTelaDoSistema("sem permissão do microfone"); return }
                usarTelaDoSistema("erro $error do reconhecedor")
            }
            override fun onEvent(eventType: Int, params: Bundle?) {}
        })
        val i = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
            .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            .putExtra(RecognizerIntent.EXTRA_LANGUAGE, "pt-BR")
            .putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
            .putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
        try { r.startListening(i) } catch (ex: Exception) { usarTelaDoSistema("falha ao iniciar: ${ex.message}") }
    }

    /** Manda a pergunta e fica na tela: o orbe passa a PENSANDO e, quando a resposta existe, a FALANDO; fecha quando a fala termina. */
    private fun enviar(frase: String) {
        if (encerrada) return
        encerrada = true
        if (frase.isBlank()) { Config.evento(this, "ouvindo: nada reconhecido; fechando"); finish(); return }
        if (pedidoDeRepetir(frase)) { repetirLocal(frase); return }
        val rid = System.currentTimeMillis().toString()      // numérico e longo: é o que o servidor exige para repetir sem re-executar
        Config.evento(this, "conversa: pedido de ${frase.length} caracteres")
        Config.estado(this).edit().putString("ultima_pergunta", frase).putString("ultima_resposta", "(aguardando…)").apply()
        Historico.add(this, true, frase)
        e.frase = frase; e.fase = Fase.PENSANDO; e.dica = "Consultando o Jarvis…"
        Config.evento(this, "orbe: pensando")
        FalaEstado.fase = FalaEstado.PENSANDO; FalaEstado.premium = false; FalaEstado.texto = ""     // marcado ANTES de o serviço subir, para a tela não achar que já acabou
        ContextCompat.startForegroundService(this, Intent(this, FalaService::class.java).putExtra("id", "c$rid").putExtra("pergunta", frase).putExtra("rid", rid))
        vigiarResposta(System.currentTimeMillis())
    }

    private fun vigiarResposta(inicio: Long) {
        var visto = 0L
        relogio.post(object : Runnable {
            override fun run() {
                if (isFinishing) return
                val agora = System.currentTimeMillis()
                if (FalaEstado.texto.isNotBlank() && e.resposta != FalaEstado.texto) e.resposta = FalaEstado.texto
                if (FalaEstado.fase == FalaEstado.FALANDO && e.fase != Fase.FALANDO) {
                    e.fase = Fase.FALANDO; visto = agora
                    Config.evento(this@ConversaActivity, "orbe: falando" + if (FalaEstado.premium) " (voz premium a caminho)" else "")
                    e.dica = if (FalaEstado.premium) "A voz do Jarvis chega em instantes." else ""
                }
                val acabou = e.fase == Fase.FALANDO && (
                    (!FalaEstado.premium && FalaEstado.fase == FalaEstado.OCIOSO) ||
                    (FalaEstado.premium && agora - visto > (e.resposta.length * 70L + 3000L).coerceIn(5000L, 14000L)))
                if (acabou) { Config.evento(this@ConversaActivity, "orbe: fala acabou; tela fecha sozinha"); relogio.postDelayed({ finish() }, 700); return }
                if (agora - inicio > 120_000L) { finish(); return }
                relogio.postDelayed(this, 150)
            }
        })
    }

    /** "Repete", "fala de novo", "o que você disse": ouve a última fala de novo, sem ir ao servidor. "Repete o briefing" continua sendo do servidor. */
    private fun pedidoDeRepetir(frase: String): Boolean {
        val f = frase.lowercase().trim().trimEnd('.', '!', '?')
        if (f.contains("briefing") || f.contains("resumo") || f.contains("notícia") || f.contains("noticia")) return false
        return Regex("^(jarvis[, ]+)?(pode )?(repete|repita|repetir|fala de novo|fale de novo|diga de novo|de novo|ouvir de novo|o que (você|voce) (disse|falou))( .*)?$").matches(f)
    }

    private fun repetirLocal(frase: String) {
        Config.evento(this, "conversa: repetindo a última fala (sem servidor)")
        e.frase = frase
        e.resposta = UltimaFala.texto(this).ifBlank { "Ainda não tenho uma fala para repetir." }
        e.fase = Fase.FALANDO; e.dica = ""
        FalaEstado.premium = false; FalaEstado.fase = FalaEstado.FALANDO
        UltimaFala.repetir(this)
        vigiarResposta(System.currentTimeMillis())
    }

    private fun cancelarTudo() {
        Config.evento(this, "ouvindo: cancelado")
        encerrada = true
        try { reconhecedor?.cancel() } catch (ex: Exception) { }
        finish()
    }

    /**
     * Modo de demonstração (adb: --ez ouvir true --ez demo true [--es fase ouvindo|pensando|falando|nada]): mostra a tela sem ligar o microfone.
     * Sem `fase`, percorre as três: ouvindo, pensando e falando.
     */
    private fun demonstrar(fase: String?) {
        e.frase = "Quanto eu tenho livre hoje"
        e.resposta = "Você tem R$ 1.346,70 livres na conta hoje."
        val inicio = System.currentTimeMillis()
        relogio.post(object : Runnable {
            override fun run() {
                val s = (System.currentTimeMillis() - inicio) / 1000.0
                val f = when (fase) {
                    "ouvindo" -> Fase.OUVINDO; "pensando" -> Fase.PENSANDO; "falando" -> Fase.FALANDO; "nada" -> Fase.NADA
                    else -> if (s < 7) Fase.OUVINDO else if (s < 11) Fase.PENSANDO else Fase.FALANDO
                }
                e.fase = f
                e.dica = when (f) { Fase.OUVINDO -> "Fale normalmente. Toque no quadrado quando terminar."; Fase.PENSANDO -> "Consultando o Jarvis…"; Fase.FALANDO -> ""; Fase.NADA -> "Toque em Cancelar e tente de novo." }
                if (f == Fase.OUVINDO) e.empurrar((0.45 + 0.45 * Math.sin(s * 5.0) * Math.cos(s * 2.3)).toFloat().coerceIn(0.1f, 1f)) else e.nivel = 0f
                if (s < 40) relogio.postDelayed(this, 110) else finish()
            }
        })
    }

    /** Plano B: a tela de reconhecimento do Google (não exige permissão de microfone). */
    private fun usarTelaDoSistema(motivo: String) {
        Config.evento(this, "conversa: tela do sistema ($motivo)")
        try { reconhecedor?.destroy() } catch (ex: Exception) { }
        reconhecedor = null
        val i = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
            .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            .putExtra(RecognizerIntent.EXTRA_LANGUAGE, "pt-BR")
            .putExtra(RecognizerIntent.EXTRA_PROMPT, "Fale com o Jarvis")
            .putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
        try {
            startActivityForResult(i, 7)
        } catch (ex: ActivityNotFoundException) {
            Toast.makeText(this, "Este celular não tem reconhecimento de fala.", Toast.LENGTH_LONG).show()
            finish()
        }
    }

    @Deprecated("API antiga, suficiente aqui")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        val f = data?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)?.firstOrNull()?.trim()
        if (requestCode == 7 && resultCode == Activity.RESULT_OK && !f.isNullOrBlank()) enviar(f) else finish()
    }

    override fun onDestroy() {
        Config.evento(this, "ouvindo: tela fechada")
        relogio.removeCallbacksAndMessages(null)
        try { reconhecedor?.destroy() } catch (ex: Exception) { }
        super.onDestroy()
    }
}
