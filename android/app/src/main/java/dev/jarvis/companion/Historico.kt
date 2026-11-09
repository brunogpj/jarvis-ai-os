package dev.jarvis.companion

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/**
 * Histórico do Chat (0.6.0): as últimas 40 mensagens trocadas (voz, atalhos e digitadas), guardadas só no aparelho.
 * Mesmo molde do chat do web app (balões; você à direita, Jarvis à esquerda), mas sem sessão: o servidor não guarda estas conversas.
 */
object Historico {
    private const val CHAVE = "chat_hist"
    private const val MAX = 40
    private val trava = Any()

    fun add(ctx: Context, voce: Boolean, texto: String) {
        val t = texto.trim()
        if (t.isEmpty()) return
        synchronized(trava) {
            val l = ler(ctx)
            l.put(JSONObject().put("v", voce).put("t", t.take(1500)).put("em", System.currentTimeMillis()))
            val corte = JSONArray()
            for (i in maxOf(0, l.length() - MAX) until l.length()) corte.put(l.get(i))
            Config.estado(ctx).edit().putString(CHAVE, corte.toString()).apply()
        }
    }

    fun ler(ctx: Context): JSONArray = try { JSONArray(Config.estado(ctx).getString(CHAVE, "[]")) } catch (e: Exception) { JSONArray() }

    fun limpar(ctx: Context) { Config.estado(ctx).edit().remove(CHAVE).apply() }

    /** Muda quando entra mensagem nova (a tela do Chat só se refaz então). */
    fun assinatura(ctx: Context): String = Config.estado(ctx).getString(CHAVE, "") ?: ""
}

/** Painel (0.6.0): os cartões do Dashboard do web app, lidos por android_dashboard e guardados para abrir já preenchido. */
object Painel {
    private const val CHAVE = "painel_cache"
    private const val EM = "painel_cache_em"

    fun buscar(ctx: Context): JSONObject? {
        val r = Api.post(ctx, JSONObject().put("action", "android_dashboard"), 60000) ?: return null
        if (!r.optBoolean("ok")) return null
        Config.estado(ctx).edit().putString(CHAVE, r.toString()).putLong(EM, System.currentTimeMillis()).apply()
        return r
    }

    fun cache(ctx: Context): JSONObject? = try { JSONObject(Config.estado(ctx).getString(CHAVE, "") ?: "") } catch (e: Exception) { null }
    fun idadeMs(ctx: Context): Long = System.currentTimeMillis() - Config.estado(ctx).getLong(EM, 0)
}
