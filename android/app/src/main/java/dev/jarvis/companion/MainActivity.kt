package dev.jarvis.companion

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.util.Base64
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.core.content.ContextCompat
import com.google.firebase.messaging.FirebaseMessaging
import dev.jarvis.companion.ui.EstadoApp
import dev.jarvis.companion.ui.JarvisApp
import dev.jarvis.companion.ui.JarvisTema

/**
 * Tela do app (0.11.0, Jetpack Compose): três áreas numa barra inferior, as mesmas do web app — Chat (balões, texto e voz), Dashboard (os cartões do
 * painel) e Dispositivo (saúde do app, permissões, voz do celular, conexão e eventos). As telas moram em `ui/`; aqui ficam só o ciclo de vida, o
 * pareamento e os ganchos de ADB.
 *
 * Pareamento (uma vez, pelo computador, sem digitar nada no celular; o JSON NÃO fica no repositório):
 *   adb shell am start -n dev.jarvis.companion/.MainActivity --es config_b64 <JSON em base64>
 */
class MainActivity : ComponentActivity() {
    private val estado = EstadoApp()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.dark(Color.TRANSPARENT),
            navigationBarStyle = SystemBarStyle.dark(Color.TRANSPARENT)
        )
        setContent { JarvisTema { JarvisApp(estado) } }
        tratarPareamento(intent)
        tratarAjusteDeVoz(intent)
        pedirPermissaoDeNotificacao()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        tratarPareamento(intent)
        tratarAjusteDeVoz(intent)
    }

    override fun onResume() {
        super.onResume()
        AckQueue.drenarAgora(this)
        NotifFila.drenarAgora(this)
        NotificacaoInterativa.drenar(this)
    }

    // ---------------------------------------------------------------- pareamento e ajuste por ADB (como antes)

    private fun tratarPareamento(i: Intent?) {
        val b64 = i?.getStringExtra("config_b64") ?: return
        i.removeExtra("config_b64")
        val json = try { String(Base64.decode(b64, Base64.DEFAULT), Charsets.UTF_8) } catch (e: Exception) { null }
        val erro = if (json == null) "base64 inválido" else Config.salvar(this, json)
        if (erro != null) { Config.evento(this, "pareamento recusado: $erro"); return }
        Config.evento(this, "pareamento aceito")
        try { Config.iniciarFirebase(this) } catch (e: Exception) { Config.evento(this, "Firebase não iniciou: ${e.message}"); return }
        FirebaseMessaging.getInstance().token.addOnCompleteListener { t ->
            if (!t.isSuccessful) { Config.evento(this, "FCM sem token: ${t.exception?.message}"); return@addOnCompleteListener }
            Thread {
                val ok = Api.registrar(this, t.result)
                Config.evento(this, if (ok) "aparelho registrado no Jarvis" else "NÃO consegui registrar o aparelho (sem rede ou token errado)")
            }.start()
        }
    }

    /**
     * Ajuste fino da voz do celular por ADB (a tela Dispositivo faz o mesmo sem computador):
     *   adb shell am start -n dev.jarvis.companion/.MainActivity --ef pitch 0.8 --ef ritmo 0.92 --es voz pt-br-x-pte-network --es testar "frase"
     * pitch/ritmo: 0.5 a 1.5; voz: nome exato de uma voz pt-BR; testar: fala a frase agora. "voz" vazia volta à escolha automática.
     */
    private fun tratarAjusteDeVoz(i: Intent?) {
        if (i == null) return
        Thread { Telemetria.lembrarWifi(applicationContext) }.start()
        val e = Config.estado(this).edit()
        var mudou = false
        if (i.hasExtra("pitch")) { e.putFloat("pitch", i.getFloatExtra("pitch", 0.88f).coerceIn(0.5f, 1.5f)); mudou = true }
        if (i.hasExtra("ritmo")) { e.putFloat("ritmo", i.getFloatExtra("ritmo", 0.95f).coerceIn(0.5f, 1.5f)); mudou = true }
        if (i.hasExtra("voz")) { e.putString("voz_preferida", i.getStringExtra("voz") ?: ""); mudou = true }
        if (mudou) { e.apply(); Config.evento(this, "ajuste de voz gravado") }
        // Diagnóstico por ADB (só leitura): --ez rotulos true grava nos eventos o nome que o app resolve para cada pacote da lista de notificações.
        // Se o nome não resolve, o servidor recebe o pacote no lugar do nome e descarta a notificação (visto em 10/11 com a Bíblia).
        if (i.getBooleanExtra("rotulos", false)) {
            NotificacaoService.apps(this).filter { it.startsWith("=") }.forEach { Config.evento(this, "rótulo " + it.substring(1).take(34) + " → " + NotificacaoService.rotuloPublico(this, it.substring(1))) }
            i.removeExtra("rotulos")
        }
        // Ouvir de novo a última fala por ADB (só repete o que o próprio Jarvis já falou): --ez repetir true
        if (i.getBooleanExtra("repetir", false)) { UltimaFala.repetir(this); i.removeExtra("repetir") }
        // Abre a tela "Ouvindo" por ADB: --ez ouvir true [--ez demo true [--es fase ouvindo|pensando|falando|nada]]
        if (i.getBooleanExtra("ouvir", false)) {
            startActivity(Intent(this, ConversaActivity::class.java).putExtra("demo", i.getBooleanExtra("demo", false)).putExtra("fase", i.getStringExtra("fase")))
            i.removeExtra("ouvir"); i.removeExtra("demo"); i.removeExtra("fase")
        }
        // Abre uma aba por ADB (o MIUI bloqueia toques injetados): --ei aba 0|1|2
        if (i.hasExtra("aba")) { estado.rolar = -1; estado.aba = i.getIntExtra("aba", 0).coerceIn(0, 2); i.removeExtra("aba") }
        // Rola a aba aberta por ADB (toque e swipe são bloqueados no MIUI): --ei rolar <pixels>. Serve para capturar a tela inteira em partes.
        if (i.hasExtra("rolar")) { estado.rolar = i.getIntExtra("rolar", 0); i.removeExtra("rolar") }
        val frase = i.getStringExtra("testar")
        if (frase != null) {
            val s = Intent(this, FalaService::class.java).putExtra("id", "t" + System.currentTimeMillis().toString(36)).putExtra("texto", frase).putExtra("local", true)
            ContextCompat.startForegroundService(this, s)
        }
        i.removeExtra("pitch"); i.removeExtra("ritmo"); i.removeExtra("voz"); i.removeExtra("testar")
    }

    private fun pedirPermissaoDeNotificacao() {
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 1)
        }
    }
}
