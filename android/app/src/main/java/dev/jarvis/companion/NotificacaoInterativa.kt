package dev.jarvis.companion

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.RemoteInput
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.net.Uri
import org.json.JSONObject

/**
 * Notificação interativa pelo app (substitui a macro Notificação Interativa): o Jarvis pergunta algo, a notificação mostra DUAS opções e o toque volta ao
 * servidor (android_callback), que faz o mesmo tratamento do callback da macro. Modo "saldo": em vez do Sim/Não, um campo de texto para digitar os valores.
 * Tocar no corpo da notificação abre o painel (link que o servidor manda), como a macro fazia. Cada notificação vale uma resposta: depois do toque ela vira a
 * resposta do servidor, sem botões. Se não der para falar com o servidor, os botões voltam, com o aviso.
 */
object NotificacaoInterativa {
    private var proximoId = 7000

    /** Mostra a notificação a partir da ordem `controle` (campos: id, titulo, texto, opcao1, opcao2, painel, modo). */
    fun mostrar(ctx: Context, d: Map<String, String>): Controles.Resultado {
        val cb = d["id"] ?: ""
        if (cb.isBlank()) return Controles.Resultado(false, "falta o id do retorno")
        val nid = proximoId++.also { if (proximoId > 7999) proximoId = 7000 }
        publicar(ctx, nid, cb, d["titulo"] ?: "Jarvis", d["texto"] ?: "", d["opcao1"] ?: "Sim", d["opcao2"] ?: "Não", d["painel"] ?: "", d["modo"] ?: "", null)
        return Controles.Resultado(true, "pergunta mostrada")
    }

    fun publicar(ctx: Context, nid: Int, cb: String, titulo: String, texto: String, op1: String, op2: String, painel: String, modo: String, aviso: String?) {
        val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.createNotificationChannel(NotificationChannel("avisos", "Avisos do Jarvis", NotificationManager.IMPORTANCE_HIGH))
        val corpo = if (aviso != null) "$aviso\n\n$texto" else texto
        val b = Notification.Builder(ctx, "avisos").setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle(titulo.take(120)).setContentText(corpo.take(300))
            .setStyle(Notification.BigTextStyle().bigText(corpo.take(1000))).setAutoCancel(false)
        // corpo da notificação: abre o painel (só http/https), senão o app
        val abrir = try {
            val u = Uri.parse(painel)
            if (painel.isNotBlank() && (u.scheme == "https" || u.scheme == "http")) Intent(Intent.ACTION_VIEW, u) else Intent(ctx, MainActivity::class.java)
        } catch (_: Exception) { Intent(ctx, MainActivity::class.java) }
        b.setContentIntent(PendingIntent.getActivity(ctx, nid * 4, abrir.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT))

        fun acao(k: Int, rotulo: String, botao: String, comTexto: Boolean): Notification.Action {
            val i = Intent(ctx, AcaoInterativaReceiver::class.java).putExtra("cb", cb).putExtra("botao", botao).putExtra("nid", nid)
                .putExtra("titulo", titulo.take(120)).putExtra("texto", texto.take(600)).putExtra("op1", op1).putExtra("op2", op2).putExtra("painel", painel).putExtra("modo", modo)
            // com campo de texto a PendingIntent precisa ser mutável (o sistema coloca a resposta digitada nela)
            val flags = PendingIntent.FLAG_UPDATE_CURRENT or (if (comTexto) PendingIntent.FLAG_MUTABLE else PendingIntent.FLAG_IMMUTABLE)
            val pi = PendingIntent.getBroadcast(ctx, nid * 4 + k, i, flags)
            val ab = Notification.Action.Builder(null, rotulo.take(30), pi)
            if (comTexto) ab.addRemoteInput(RemoteInput.Builder("resposta").setLabel("Saldos (ex.: 700, 250)").build())
            return ab.build()
        }
        if (modo == "saldo") {
            b.addAction(acao(1, "Informar", "texto", true))
            b.addAction(acao(2, op2.ifBlank { "Depois" }, "2", false))
        } else {
            b.addAction(acao(1, op1.ifBlank { "Sim" }, "1", false))
            b.addAction(acao(2, op2.ifBlank { "Não" }, "2", false))
        }
        nm.notify(nid, b.build())
    }

    // ---- fila de retornos (guardada no aparelho): sobrevive a queda de rede e à morte do processo ----
    private val trava = Any()
    private val exec = java.util.concurrent.Executors.newSingleThreadExecutor()
    private fun fila(ctx: Context): org.json.JSONArray = try { org.json.JSONArray(Config.estado(ctx).getString("interativa_fila", "[]")) } catch (_: Exception) { org.json.JSONArray() }
    private fun gravar(ctx: Context, f: org.json.JSONArray) { Config.estado(ctx).edit().putString("interativa_fila", f.toString()).apply() }

    fun enfileirar(ctx: Context, item: JSONObject) {
        synchronized(trava) { val f = fila(ctx); f.put(item); gravar(ctx, f) }
        drenar(ctx)
    }

    /** Envia os retornos pendentes, um por vez. Também é chamada ao abrir o app e ao iniciar o processo. */
    fun drenar(ctx: Context) {
        val app = ctx.applicationContext
        exec.execute {
            while (true) {
                val item = synchronized(trava) { fila(app).let { if (it.length() == 0) null else it.getJSONObject(0) } } ?: return@execute
                // retorno com mais de 15 min não vale mais (o callback do servidor expira): descarta e avisa
                val velho = System.currentTimeMillis() - item.optLong("em") > 15 * 60 * 1000L
                var r: JSONObject? = null
                if (!velho) {
                    val corpo = JSONObject().put("action", "android_callback").put("id", item.optString("cb")).put("botao", item.optString("botao")).put("resposta", item.optString("resposta"))
                    for (espera in longArrayOf(0, 3000)) {
                        if (espera > 0) Thread.sleep(espera)
                        r = Api.post(app, JSONObject(corpo.toString()), 90000)
                        if (r != null) break
                    }
                    if (r == null) return@execute     // sem rede: fica na fila para a próxima chance
                }
                synchronized(trava) { fila(app).also { f -> val n = org.json.JSONArray(); for (i in 1 until f.length()) n.put(f.get(i)); gravar(app, n) } }
                val nid = item.optInt("nid"); val titulo = item.optString("titulo")
                if (r == null) { substituir(app, nid, titulo, "Essa pergunta expirou sem resposta."); continue }
                val msg = r.optString("mensagem").ifBlank { if (r.optBoolean("ok")) "Pronto." else "O Jarvis não aceitou a resposta." }
                Config.evento(app, "interativa: servidor respondeu (" + (if (r.optBoolean("ok")) "ok" else "recusou") + ")")
                if (!r.optBoolean("ok") && item.optString("modo") == "saldo" && (msg.startsWith("Não entendi") || msg.startsWith("Digite os saldos")))
                    publicar(app, nid, item.optString("cb"), titulo, item.optString("texto"), item.optString("op1"), item.optString("op2"), item.optString("painel"), "saldo", msg)
                else substituir(app, nid, titulo, msg)
            }
        }
    }

    fun substituir(ctx: Context, nid: Int, titulo: String, texto: String) {
        val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.notify(nid, Notification.Builder(ctx, "avisos").setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle(titulo.take(120)).setContentText(texto.take(300))
            .setStyle(Notification.BigTextStyle().bigText(texto.take(1000))).setAutoCancel(true).setOnlyAlertOnce(true).build())
    }
}

class AcaoInterativaReceiver : BroadcastReceiver() {
    /**
     * O receptor NÃO espera o servidor: o retorno leva mais de 10 s (grava no log da wiki e avisa) e o Android matava o app por ANR (visto em 11/11,
     * 13:55:18). Aqui só se guarda o toque numa fila e se avisa "Enviando…"; a fila envia, reenvia se faltar rede e atualiza a notificação.
     */
    override fun onReceive(ctx: Context, i: Intent) {
        val cb = i.getStringExtra("cb") ?: return
        val botao = i.getStringExtra("botao") ?: return
        if (botao != "1" && botao != "2" && botao != "texto") return
        val resposta = RemoteInput.getResultsFromIntent(i)?.getCharSequence("resposta")?.toString()?.trim() ?: ""
        if (botao == "texto" && resposta.isBlank()) return
        val app = ctx.applicationContext
        val nid = i.getIntExtra("nid", 0)
        val titulo = i.getStringExtra("titulo") ?: "Jarvis"
        NotificacaoInterativa.substituir(app, nid, titulo, "Enviando a sua resposta…")
        Config.evento(app, "interativa: toque $botao")
        NotificacaoInterativa.enfileirar(app, JSONObject().put("cb", cb).put("botao", botao).put("resposta", resposta).put("nid", nid).put("titulo", titulo)
            .put("texto", i.getStringExtra("texto") ?: "").put("op1", i.getStringExtra("op1") ?: "Sim").put("op2", i.getStringExtra("op2") ?: "Não")
            .put("painel", i.getStringExtra("painel") ?: "").put("modo", i.getStringExtra("modo") ?: "").put("em", System.currentTimeMillis()))
    }
}
