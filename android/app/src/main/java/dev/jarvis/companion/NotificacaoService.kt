package dev.jarvis.companion

import android.app.Notification
import android.content.pm.PackageManager
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.Executors

/**
 * Captura as notificações do celular e manda ao Jarvis (substitui a macro "Notificações Premium" do MacroDroid).
 *
 * PRIVACIDADE: o servidor diz quais apps interessam (NOTIF_APPS) e o app só envia notificação de app dessa lista. Sem lista, ou
 * com o canal desligado no servidor (ANDROID_NOTIF), NADA sai do celular. Nunca envia notificação do próprio Jarvis nem as fixas
 * (música tocando, carregando) ou de resumo de grupo.
 *
 * ENTREGA: cada notificação vai para uma fila guardada no aparelho e é reenviada até o servidor confirmar (o /exec perde respostas).
 * Reenviar é seguro: o servidor descarta a mesma notificação por 5 minutos.
 *
 * Exige a permissão especial "Acesso às notificações" (Configurações → Notificações → Acesso a notificações), que só o dono concede.
 */
class NotificacaoService : NotificationListenerService() {
    private val exec = Executors.newSingleThreadExecutor()

    override fun onListenerConnected() {
        Config.evento(this, "notificações: escuta ligada")
        exec.execute { atualizarConfig(this) }
    }

    override fun onNotificationPosted(sbn: StatusBarNotification?) {
        val n = sbn ?: return
        if (n.packageName == packageName) return
        val flags = n.notification.flags
        if (flags and Notification.FLAG_GROUP_SUMMARY != 0 || flags and Notification.FLAG_ONGOING_EVENT != 0) return
        val ctx = applicationContext
        exec.execute {
            if (!configPronta(ctx)) atualizarConfig(ctx)
            val apps = apps(ctx)
            if (!ativo(ctx) || apps.isEmpty()) return@execute
            val rotulo = rotuloDe(ctx, n.packageName)
            if (!naLista(apps, rotulo, n.packageName)) return@execute
            val e = n.notification.extras
            val titulo = (e.getCharSequence(Notification.EXTRA_TITLE) ?: "").toString()
            val texto = (e.getCharSequence(Notification.EXTRA_BIG_TEXT) ?: e.getCharSequence(Notification.EXTRA_TEXT) ?: "").toString()
            if (titulo.isBlank() && texto.isBlank()) return@execute
            NotifFila.enviar(ctx, JSONObject().put("app", rotulo).put("pacote", n.packageName).put("titulo", titulo).put("texto", texto))
        }
    }

    private fun rotuloDe(ctx: android.content.Context, pacote: String): String = try {
        ctx.packageManager.getApplicationLabel(ctx.packageManager.getApplicationInfo(pacote, 0)).toString()
    } catch (e: PackageManager.NameNotFoundException) { pacote }

    companion object {
        private const val VALIDADE_MS = 30 * 60 * 1000L

        private fun naLista(lista: List<String>, app: String, pacote: String): Boolean {
            val a = app.lowercase(); val p = pacote.lowercase()
            // mesma regra do servidor (_notifNaLista): "=pacote" é pacote exato; o resto casa por trecho do nome ou do pacote
            return lista.any { if (it.startsWith("=")) p == it.substring(1) else a.contains(it) || p.contains(it) }
        }

        fun ativo(ctx: android.content.Context) = Config.estado(ctx).getBoolean("notif_ativo", false)
        fun apps(ctx: android.content.Context): List<String> = try {
            val a = JSONArray(Config.estado(ctx).getString("notif_apps", "[]"))
            (0 until a.length()).map { a.getString(it).lowercase() }.filter { it.isNotBlank() }
        } catch (e: Exception) { emptyList() }
        fun atualizarEmSegundoPlano(ctx: android.content.Context) { val app = ctx.applicationContext; Thread { atualizarConfig(app) }.start() }
        private fun configPronta(ctx: android.content.Context) =
            System.currentTimeMillis() - Config.estado(ctx).getLong("notif_config_em", 0) < VALIDADE_MS

        /** Pergunta ao servidor se o canal está ligado e quais apps interessam. Falhou → fica a última configuração conhecida. */
        fun atualizarConfig(ctx: android.content.Context) {
            val r = Api.post(ctx, JSONObject().put("action", "android_notif_config")) ?: return
            if (!r.optBoolean("ok")) return
            Config.estado(ctx).edit()
                .putBoolean("notif_ativo", r.optBoolean("ativo"))
                .putString("notif_apps", (r.optJSONArray("apps") ?: JSONArray()).toString())
                .putLong("notif_config_em", System.currentTimeMillis()).apply()
        }
    }
}

/** Fila de notificações a enviar, com reenvio (mesmo molde da AckQueue). Guarda no máximo 50 e descarta o que passou de 3 horas. */
object NotifFila {
    private val exec = Executors.newSingleThreadExecutor()
    private val trava = Any()

    fun enviar(ctx: android.content.Context, n: JSONObject) {
        val app = ctx.applicationContext
        synchronized(trava) {
            val f = fila(app)
            f.put(n.put("em", System.currentTimeMillis()))
            val corte = JSONArray()
            for (i in maxOf(0, f.length() - 50) until f.length()) corte.put(f.get(i))
            gravar(app, corte)
        }
        exec.execute { drenar(app) }
    }

    fun drenarAgora(ctx: android.content.Context) { val app = ctx.applicationContext; exec.execute { drenar(app) } }

    private fun drenar(app: android.content.Context) {
        while (true) {
            val item = synchronized(trava) { fila(app).let { if (it.length() == 0) null else it.getJSONObject(0) } } ?: return
            val velha = System.currentTimeMillis() - item.optLong("em") > 3 * 60 * 60 * 1000L
            var feito = velha
            if (!feito) {
                for (espera in longArrayOf(0, 2000, 6000)) {
                    if (espera > 0) Thread.sleep(espera)
                    val corpo = JSONObject(item.toString()).put("action", "android_notificacao")
                    corpo.remove("em")
                    val r = Api.post(app, corpo)
                    if (r?.optBoolean("ok") == true) { feito = true; break }
                }
            }
            if (!feito) return                                   // sem rede: fica na fila para a próxima chance
            synchronized(trava) { fila(app).also { f -> val novo = JSONArray(); for (i in 1 until f.length()) novo.put(f.get(i)); gravar(app, novo) } }
        }
    }

    fun pendentes(ctx: android.content.Context): Int = fila(ctx.applicationContext).length()

    private fun fila(app: android.content.Context): JSONArray =
        try { JSONArray(Config.estado(app).getString("notif_fila", "[]")) } catch (e: Exception) { JSONArray() }

    private fun gravar(app: android.content.Context, f: JSONArray) { Config.estado(app).edit().putString("notif_fila", f.toString()).apply() }
}
