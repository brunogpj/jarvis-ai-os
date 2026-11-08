package dev.jarvis.companion

import android.content.Intent
import androidx.core.content.ContextCompat
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

/** Recebe as ordens do Jarvis por push. Cada ordem tem `id` e `tipo`; a primeira coisa é CONFIRMAR o recebimento. */
class JarvisMessagingService : FirebaseMessagingService() {

    override fun onNewToken(token: String) {
        Config.evento(this, "token FCM novo; registrando no Jarvis")
        Thread {
            val ok = Api.registrar(this, token)
            Config.evento(this, if (ok) "aparelho registrado no Jarvis" else "NÃO consegui registrar o aparelho (sem rede?)")
        }.start()
    }

    override fun onMessageReceived(m: RemoteMessage) {
        val d = m.data
        val id = d["id"] ?: return
        val tipo = d["tipo"] ?: return

        // O FCM pode entregar a mesma mensagem duas vezes: ordem já vista não repete (mas confirma de novo).
        if (jaVista(id)) { AckQueue.enviar(this, id, "recebido", "repetida"); return }
        marcarVista(id)

        Config.evento(this, "ordem $tipo ($id)")
        AckQueue.enviar(this, id, "recebido")

        when (tipo) {
            "falar" -> {
                val i = Intent(this, FalaService::class.java)
                    .putExtra("id", id)
                    .putExtra("texto", d["texto"] ?: "")
                    .putExtra("audio_url", d["audio_url"] ?: "")
                    .putExtra("local", d["local"] == "1")
                ContextCompat.startForegroundService(this, i)
            }
            else -> AckQueue.enviar(this, id, "erro", "tipo desconhecido: $tipo")
        }
    }

    private fun jaVista(id: String): Boolean =
        (Config.estado(this).getString("vistas", "") ?: "").split(",").contains(id)

    private fun marcarVista(id: String) {
        val p = Config.estado(this)
        val lista = (p.getString("vistas", "") ?: "").split(",").filter { it.isNotBlank() }.toMutableList()
        lista.add(id)
        p.edit().putString("vistas", lista.takeLast(40).joinToString(",")).apply()
    }
}
