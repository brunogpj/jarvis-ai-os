package dev.jarvis.companion

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.Typeface
import android.os.Build
import android.os.Bundle
import android.util.Base64
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import com.google.firebase.messaging.FirebaseMessaging
import java.net.URI

/**
 * Tela de status do app e porta do pareamento.
 *
 * Pareamento (uma vez, pelo computador, sem digitar nada no celular; o JSON NÃO fica no repositório):
 *   adb shell am start -n dev.jarvis.companion/.MainActivity --es config_b64 <JSON em base64>
 */
class MainActivity : Activity() {
    private lateinit var status: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        montarTela()
        tratarPareamento(intent)
        pedirPermissaoDeNotificacao()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        tratarPareamento(intent)
    }

    override fun onResume() {
        super.onResume()
        atualizar()
        AckQueue.drenarAgora(this)
    }

    private fun montarTela() {
        val titulo = TextView(this).apply { text = "Jarvis"; textSize = 30f; setTextColor(Color.parseColor("#22d3d3")) }
        status = TextView(this).apply {
            textSize = 14f; setTextColor(Color.parseColor("#c9cde4")); typeface = Typeface.MONOSPACE; setPadding(0, 24, 0, 24)
        }
        val falar = botao("Falar com o Jarvis") { startActivity(Intent(this, ConversaActivity::class.java)) }.apply {
            textSize = 22f; setPadding(0, 56, 0, 56); setTextColor(Color.parseColor("#0d0f1e")); setBackgroundColor(Color.parseColor("#22d3d3"))
        }
        val atualizar = botao("Atualizar") { atualizar() }
        val testar = botao("Testar a voz do celular") { testarVoz() }
        val raiz = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(48, 96, 48, 48)
            setBackgroundColor(Color.parseColor("#0d0f1e"))
            addView(titulo); addView(falar); addView(status); addView(atualizar); addView(testar)
        }
        setContentView(ScrollView(this).apply { setBackgroundColor(Color.parseColor("#0d0f1e")); addView(raiz) })
    }

    private fun botao(rotulo: String, acao: () -> Unit) = Button(this).apply {
        text = rotulo
        setOnClickListener { acao() }
    }

    private fun tratarPareamento(i: Intent?) {
        val b64 = i?.getStringExtra("config_b64") ?: return
        i.removeExtra("config_b64")
        val json = try { String(Base64.decode(b64, Base64.DEFAULT), Charsets.UTF_8) } catch (e: Exception) { null }
        val erro = if (json == null) "base64 inválido" else Config.salvar(this, json)
        if (erro != null) { Config.evento(this, "pareamento recusado: $erro"); atualizar(); return }
        Config.evento(this, "pareamento aceito")
        try { Config.iniciarFirebase(this) } catch (e: Exception) { Config.evento(this, "Firebase não iniciou: ${e.message}"); atualizar(); return }
        FirebaseMessaging.getInstance().token.addOnCompleteListener { t ->
            if (!t.isSuccessful) { Config.evento(this, "FCM sem token: ${t.exception?.message}"); runOnUiThread { atualizar() }; return@addOnCompleteListener }
            Thread {
                val ok = Api.registrar(this, t.result)
                Config.evento(this, if (ok) "aparelho registrado no Jarvis" else "NÃO consegui registrar o aparelho (sem rede ou token errado)")
                runOnUiThread { atualizar() }
            }.start()
        }
        atualizar()
    }

    private fun pedirPermissaoDeNotificacao() {
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 1)
        }
    }

    /** Fala pela voz do celular sem passar pelo servidor: prova que o serviço, o canal e o volume funcionam. */
    private fun testarVoz() {
        val i = Intent(this, FalaService::class.java)
            .putExtra("id", "teste" + System.currentTimeMillis().toString(36))
            .putExtra("texto", "Teste do aplicativo Android do Jarvis.")
            .putExtra("local", true)
        androidx.core.content.ContextCompat.startForegroundService(this, i)
        Config.evento(this, "teste de voz local")
        atualizar()
    }

    private fun atualizar() {
        val pareado = Config.pareado(this)
        val host = try { URI(Config.url(this) ?: "").host ?: "?" } catch (e: Exception) { "?" }
        val notif = if (Build.VERSION.SDK_INT >= 33)
            if (checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) "permitidas" else "NEGADAS (a fala toca, mas sem aviso fixo)"
        else "não exigidas"
        status.text = buildString {
            appendLine("app ${BuildConfigVersao.NOME}")
            appendLine("${Build.MANUFACTURER} ${Build.MODEL} · Android ${Build.VERSION.RELEASE}")
            appendLine()
            appendLine("pareado: ${if (pareado) "sim ($host)" else "NÃO"}")
            appendLine("notificações: $notif")
            appendLine("confirmações na fila: ${AckQueue.pendentes(this@MainActivity)}")
            val perg = Config.estado(this@MainActivity).getString("ultima_pergunta", null)
            if (perg != null) {
                appendLine()
                appendLine("última conversa:")
                appendLine("você: $perg")
                appendLine("Jarvis: ${Config.estado(this@MainActivity).getString("ultima_resposta", "")}")
            }
            appendLine()
            appendLine("últimos eventos:")
            append(Config.eventos(this@MainActivity).ifBlank { "(nenhum)" })
        }
    }
}
