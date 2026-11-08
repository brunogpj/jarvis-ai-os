package dev.jarvis.companion

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.Executors

/**
 * Fila de confirmações (recebido / tocando / concluido / erro) com reenvio.
 *
 * Fica guardada no aparelho: se não houver sinal ou o /exec perder a resposta, a confirmação continua na fila e sai na
 * próxima chance (nova ordem, token novo ou abertura do app). O servidor ignora confirmação repetida ou atrasada, então
 * repetir é seguro. É o que o MacroDroid não fazia: ele mandava uma vez e esquecia.
 */
object AckQueue {
    private val exec = Executors.newSingleThreadExecutor()
    private val esperas = longArrayOf(0, 2000, 6000, 15000)   // tentativas por item na mesma rodada

    fun enviar(ctx: Context, id: String, estado: String, detalhe: String = "") {
        val app = ctx.applicationContext
        sincronizado { fila(app).also { it.put(JSONObject().put("id", id).put("estado", estado).put("detalhe", detalhe)); gravar(app, it) } }
        exec.execute { drenar(app) }
    }

    /** Tenta esvaziar a fila (chamado na abertura do app e a cada ordem). */
    fun drenarAgora(ctx: Context) { val app = ctx.applicationContext; exec.execute { drenar(app) } }

    private fun drenar(app: Context) {
        while (true) {
            val item = sincronizado { fila(app).let { if (it.length() == 0) null else it.getJSONObject(0) } } ?: return
            var feito = false
            for (espera in esperas) {
                if (espera > 0) Thread.sleep(espera)
                if (Api.ack(app, item.getString("id"), item.getString("estado"), item.optString("detalhe"))) { feito = true; break }
            }
            if (!feito) { Config.evento(app, "sem rede para confirmar ${item.getString("estado")}; fica na fila"); return }
            sincronizado { fila(app).also { f -> val novo = JSONArray(); for (i in 1 until f.length()) novo.put(f.get(i)); gravar(app, novo) } }
        }
    }

    private fun fila(app: Context): JSONArray =
        try { JSONArray(Config.estado(app).getString("ack_fila", "[]")) } catch (e: Exception) { JSONArray() }

    private fun gravar(app: Context, f: JSONArray) { Config.estado(app).edit().putString("ack_fila", f.toString()).apply() }

    fun pendentes(ctx: Context): Int = fila(ctx.applicationContext).length()

    private val trava = Any()
    private fun <T> sincronizado(bloco: () -> T): T = synchronized(trava) { bloco() }
}
