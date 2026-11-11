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

        Saude.ordemRecebida(this, tipo)
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
            "telemetria" -> {
                // O servidor pede a leitura (a cada 15 min); o app responde por android_telemetria e confirma.
                Thread {
                    val (ok, det) = try { Telemetria.enviar(this) } catch (e: Exception) { false to (e.javaClass.simpleName + ": " + (e.message ?: "")).take(80) }
                    Config.evento(this, "telemetria: " + (if (ok) "enviada" else "FALHOU") + " · " + det)
                    AckQueue.enviar(this, id, if (ok) "concluido" else "erro", det)
                }.start()
            }
            "controle" -> {
                // Controles do celular (fase 4): lista fechada em Controles; o resultado volta como concluido ou erro.
                val r = Controles.executar(this, d)
                Config.evento(this, "controle ${d["acao"]}: " + (if (r.ok) "ok" else "FALHOU") + " · " + r.detalhe)
                AckQueue.enviar(this, id, if (r.ok) "concluido" else "erro", r.detalhe)
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
