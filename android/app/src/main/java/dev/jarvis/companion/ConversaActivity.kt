package dev.jarvis.companion

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.os.Bundle
import android.speech.RecognizerIntent
import android.widget.Toast
import androidx.core.content.ContextCompat

/**
 * Janela transparente que abre o reconhecimento de fala do Google em pt-BR e entrega a frase ao FalaService (que conversa com o
 * Jarvis e fala a resposta). Usa a tela de reconhecimento do próprio sistema: não pede permissão de microfone ao app.
 * Aberta pelo botão da tela principal e pelo atalho das configurações rápidas.
 */
class ConversaActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val i = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
            .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            .putExtra(RecognizerIntent.EXTRA_LANGUAGE, "pt-BR")
            .putExtra(RecognizerIntent.EXTRA_PROMPT, "Fale com o Jarvis")
            .putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
        try {
            startActivityForResult(i, 7)
        } catch (e: ActivityNotFoundException) {
            Toast.makeText(this, "Este celular não tem reconhecimento de fala.", Toast.LENGTH_LONG).show()
            Config.evento(this, "conversa: sem reconhecimento de fala no aparelho")
            finish()
        }
    }

    @Deprecated("API antiga, suficiente aqui")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        val frase = data?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)?.firstOrNull()?.trim()
        if (requestCode == 7 && resultCode == RESULT_OK && !frase.isNullOrBlank()) {
            val rid = System.currentTimeMillis().toString()      // numérico e longo: é o que o servidor exige para repetir sem re-executar
            Config.evento(this, "conversa: pedido de ${frase.length} caracteres")
            Config.estado(this).edit().putString("ultima_pergunta", frase).putString("ultima_resposta", "(aguardando…)").apply()
            val s = Intent(this, FalaService::class.java).putExtra("id", "c$rid").putExtra("pergunta", frase).putExtra("rid", rid)
            ContextCompat.startForegroundService(this, s)
        }
        finish()
    }
}
