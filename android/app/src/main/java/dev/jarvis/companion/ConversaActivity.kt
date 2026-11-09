package dev.jarvis.companion

import android.Manifest
import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Typeface
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.core.content.ContextCompat

/**
 * Tela "Ouvindo" (0.5.1): reconhecimento de fala DENTRO do app, em pt-BR, com a frase aparecendo enquanto você fala e barras que
 * acompanham o volume. Aberta pelo orbe e pelo atalho das configurações rápidas.
 *
 * Precisa da permissão de microfone (pedida na primeira vez). Sem permissão, sem serviço de reconhecimento no aparelho ou com erro do
 * reconhecedor, cai na tela de reconhecimento do próprio Google (a da 0.3.x), que não exige permissão: o app nunca fica sem a conversa.
 */
class ConversaActivity : Activity() {
    private var reconhecedor: SpeechRecognizer? = null
    private lateinit var rotulo: TextView
    private lateinit var frase: TextView
    private lateinit var onda: OndaView
    private lateinit var dica: TextView
    private var ultimaParcial = ""
    private var encerrada = false
    private val relogio = Handler(Looper.getMainLooper())

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.statusBarColor = Cores.FUNDO
        window.navigationBarColor = Cores.FUNDO
        montarTela()
        if (intent.getBooleanExtra("demo", false)) { demonstrar(); return }
        Config.evento(this, "ouvindo: tela aberta (microfone ${if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) "liberado" else "sem permissão"})")
        if (!SpeechRecognizer.isRecognitionAvailable(this)) { usarTelaDoSistema("sem serviço de reconhecimento"); return }
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) comecar()
        else requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), 11)
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == 11) {
            if (grantResults.isNotEmpty() && grantResults[0] == PackageManager.PERMISSION_GRANTED) comecar()
            else usarTelaDoSistema("microfone negado")
        }
    }

    private fun montarTela() {
        rotulo = TextView(this).apply {
            text = "OUVINDO"; textSize = 12f; letterSpacing = 0.1f; setTextColor(Cores.DESTAQUE); gravity = Gravity.CENTER
            typeface = Tipografia.inter(context, 600)
        }
        frase = TextView(this).apply {
            text = ""; textSize = 30f; setTextColor(Cores.TEXTO); gravity = Gravity.CENTER; setLineSpacing(0f, 1.1f)
            typeface = Tipografia.grotesk(context, 500)
        }
        onda = OndaView(this)
        dica = TextView(this).apply {
            text = "Fale normalmente. Toque no quadrado quando terminar."; textSize = 13f; setTextColor(Cores.SECUNDARIO); gravity = Gravity.CENTER
            typeface = Tipografia.inter(context, 400)
        }
        val parar = Button(this).apply {
            contentDescription = "Parar de ouvir"
            background = fundoArredondado(Cores.DESTAQUE, dp(48).toFloat())
            stateListAnimator = null
            setOnClickListener { reconhecedor?.stopListening(); dica.text = "Processando…" }
        }
        val quadrado = object : View(this) {
            override fun onDraw(c: android.graphics.Canvas) {
                val p = android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG).apply { color = Cores.FUNDO }
                val m = width * 0.3f
                c.drawRoundRect(android.graphics.RectF(m, m, width - m, height - m), dp(5).toFloat(), dp(5).toFloat(), p)
            }
        }
        val botao = FrameLayout(this).apply {
            addView(parar, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
            addView(quadrado, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
            quadrado.isClickable = false
        }
        val cancelar = Button(this).apply {
            text = "Cancelar"; isAllCaps = false; textSize = 14f; setTextColor(Cores.TEXTO2); stateListAnimator = null
            background = fundoArredondado(android.graphics.Color.TRANSPARENT, 0f)
            typeface = Tipografia.inter(context, 500)
            setOnClickListener { cancelarTudo() }
        }

        val centro = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER; setPadding(dp(28), 0, dp(28), 0)
            addView(rotulo)
            addView(frase, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(24) })
            addView(onda, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(72)).apply { topMargin = dp(28) })
            addView(dica, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(20) })
        }
        val rodape = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER_HORIZONTAL; setPadding(0, dp(8), 0, dp(36))
            addView(botao, LinearLayout.LayoutParams(dp(96), dp(96)))
            addView(cancelar, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, dp(48)).apply { topMargin = dp(10) })
        }
        setContentView(LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL; setBackgroundColor(Cores.FUNDO)
            addView(centro, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
            addView(rodape, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        })
    }

    private fun comecar() {
        val r = SpeechRecognizer.createSpeechRecognizer(this)
        reconhecedor = r
        r.setRecognitionListener(object : RecognitionListener {
            override fun onReadyForSpeech(params: Bundle?) { Config.evento(this@ConversaActivity, "ouvindo: reconhecedor pronto"); dica.text = "Fale agora." }
            override fun onBeginningOfSpeech() { Config.evento(this@ConversaActivity, "ouvindo: começou a captar voz"); dica.text = "Fale normalmente. Toque no quadrado quando terminar." }
            override fun onRmsChanged(rmsdB: Float) { onda.empurrar((rmsdB + 2f) / 12f) }       // -2..10 dB → 0..1
            override fun onBufferReceived(buffer: ByteArray?) {}
            override fun onEndOfSpeech() { Config.evento(this@ConversaActivity, "ouvindo: fim da fala"); dica.text = "Processando…" }
            override fun onPartialResults(partialResults: Bundle?) {
                val t = partialResults?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull() ?: return
                if (t.isNotBlank()) { ultimaParcial = t; frase.text = t }
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
                    rotulo.text = "NÃO OUVI NADA"; dica.text = "Toque em Cancelar e tente de novo."
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
        try { r.startListening(i) } catch (e: Exception) { usarTelaDoSistema("falha ao iniciar: ${e.message}") }
    }

    private fun enviar(frase: String) {
        if (encerrada) return
        encerrada = true
        if (frase.isBlank()) { Config.evento(this, "ouvindo: nada reconhecido; fechando"); finish(); return }
        val rid = System.currentTimeMillis().toString()      // numérico e longo: é o que o servidor exige para repetir sem re-executar
        Config.evento(this, "conversa: pedido de ${frase.length} caracteres")
        Config.estado(this).edit().putString("ultima_pergunta", frase).putString("ultima_resposta", "(aguardando…)").apply()
        Historico.add(this, true, frase)
        ContextCompat.startForegroundService(this, Intent(this, FalaService::class.java).putExtra("id", "c$rid").putExtra("pergunta", frase).putExtra("rid", rid))
        finish()
    }

    private fun cancelarTudo() {
        Config.evento(this, "ouvindo: cancelado")
        encerrada = true
        try { reconhecedor?.cancel() } catch (e: Exception) { }
        finish()
    }

    /** Modo de demonstração (adb: --ez ouvir true --ez demo true): mostra a tela com uma frase e barras animadas, sem ligar o microfone. */
    private fun demonstrar() {
        frase.text = "Quanto eu tenho livre hoje"
        dica.text = "Fale normalmente. Toque no quadrado quando terminar."
        val inicio = System.currentTimeMillis()
        relogio.post(object : Runnable {
            override fun run() {
                val s = (System.currentTimeMillis() - inicio) / 1000.0
                onda.empurrar((0.45 + 0.45 * Math.sin(s * 5.0) * Math.cos(s * 2.3)).toFloat().coerceIn(0.1f, 1f))
                if (s < 25) relogio.postDelayed(this, 110) else finish()
            }
        })
    }

    /** Plano B: a tela de reconhecimento do Google (não exige permissão de microfone). */
    private fun usarTelaDoSistema(motivo: String) {
        Config.evento(this, "conversa: tela do sistema ($motivo)")
        try { reconhecedor?.destroy() } catch (e: Exception) { }
        reconhecedor = null
        val i = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
            .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            .putExtra(RecognizerIntent.EXTRA_LANGUAGE, "pt-BR")
            .putExtra(RecognizerIntent.EXTRA_PROMPT, "Fale com o Jarvis")
            .putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
        try {
            startActivityForResult(i, 7)
        } catch (e: ActivityNotFoundException) {
            Toast.makeText(this, "Este celular não tem reconhecimento de fala.", Toast.LENGTH_LONG).show()
            finish()
        }
    }

    @Deprecated("API antiga, suficiente aqui")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        val f = data?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)?.firstOrNull()?.trim()
        if (requestCode == 7 && resultCode == RESULT_OK && !f.isNullOrBlank()) enviar(f) else finish()
    }

    override fun onDestroy() {
        relogio.removeCallbacksAndMessages(null)
        try { reconhecedor?.destroy() } catch (e: Exception) { }
        super.onDestroy()
    }
}
