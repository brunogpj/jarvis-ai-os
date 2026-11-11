package dev.jarvis.companion

import android.app.Notification
import android.app.NotificationManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * Botões "Sim / Não / Desfaz" das notificações de aviso da caderneta (Controles.notificar com `acoes`).
 * O toque manda ao Jarvis a MESMA frase que o dono diria ("sim", "não", "desfaz") pelo caminho da conversa, então vale toda a cadeia de
 * confirmação que já existe (propor → sim → desfaz, com validade da proposta). Lista fechada de três frases: nada que venha da notificação
 * vira texto livre. A resposta substitui a notificação (sem botões, para não repetir o toque) e entra no histórico do Chat.
 */
class AcaoNotificacao : BroadcastReceiver() {
    override fun onReceive(ctx: Context, i: Intent) {
        val frase = i.getStringExtra("frase") ?: return
        if (frase !in FRASES) return
        val nid = i.getIntExtra("nid", 0)
        val titulo = i.getStringExtra("titulo") ?: "Jarvis"
        val app = ctx.applicationContext
        mostrar(app, nid, titulo, "Enviando “$frase”…")
        Thread {
            try {
                Config.evento(app, "botão da notificação: $frase")
                Historico.add(app, true, frase)
                val r = Conversa.perguntarR(app, frase, System.currentTimeMillis().toString(), botao = true)
                Historico.add(app, false, r.texto)
                mostrar(app, nid, titulo, r.texto)
            } catch (e: Exception) {
                mostrar(app, nid, titulo, "Não consegui falar com o Jarvis agora. Diga “$frase” por voz.")
            } finally { }
        }.start()
    }

    /** Troca a notificação. Se a resposta do Jarvis é uma nova pergunta ("… Diga sim ou não."), ela volta com Sim e Não: o "Desfaz" tem duas etapas. */
    private fun mostrar(ctx: Context, nid: Int, titulo: String, texto: String) {
        val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val b = Notification.Builder(ctx, "avisos").setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle(titulo.take(120)).setContentText(texto.take(300))
            .setStyle(Notification.BigTextStyle().bigText(texto.take(1000))).setAutoCancel(true).setOnlyAlertOnce(true)
        if (Regex("sim ou n[ãa]o", RegexOption.IGNORE_CASE).containsMatchIn(texto)) {
            listOf("Sim" to "sim", "Não" to "não").forEachIndexed { k, (rotulo, frase) ->
                val pi = android.app.PendingIntent.getBroadcast(ctx, nid * 4 + k,
                    Intent(ctx, AcaoNotificacao::class.java).putExtra("frase", frase).putExtra("nid", nid).putExtra("titulo", titulo.take(120)),
                    android.app.PendingIntent.FLAG_IMMUTABLE or android.app.PendingIntent.FLAG_UPDATE_CURRENT)
                b.addAction(Notification.Action.Builder(null, rotulo, pi).build())
            }
        }
        nm.notify(nid, b.build())
    }

    companion object { val FRASES = setOf("sim", "não", "desfaz") }
}
