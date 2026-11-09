package dev.jarvis.companion

import android.content.Context
import android.os.Build
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/**
 * Conversa com o doPost do Jarvis (Apps Script). O /exec responde 302 e o segundo salto às vezes dá 404 DEPOIS de o
 * pedido ter sido processado (medido em 2026): por isso toda chamada daqui é idempotente e quem chama repete (ver AckQueue).
 */
object Api {
    /** POST com o token do pareamento. Devolve o JSON da resposta, ou null se não deu para falar com o servidor. */
    fun post(ctx: Context, corpo: JSONObject): JSONObject? {
        val url = Config.url(ctx) ?: return null
        val token = Config.token(ctx) ?: return null
        return try {
            corpo.put("token", token)
            val c = URL(url).openConnection() as HttpURLConnection
            c.requestMethod = "POST"
            c.doOutput = true
            c.connectTimeout = 15000
            c.readTimeout = 30000
            c.instanceFollowRedirects = true
            c.setRequestProperty("Content-Type", "application/json")
            c.outputStream.use { it.write(corpo.toString().toByteArray(Charsets.UTF_8)) }
            val ok = c.responseCode in 200..299
            val texto = (if (ok) c.inputStream else c.errorStream)?.bufferedReader()?.use { it.readText() } ?: ""
            c.disconnect()
            if (!ok) null else JSONObject(texto)
        } catch (e: Exception) {
            null
        }
    }

    fun registrar(ctx: Context, fcmToken: String): Boolean {
        val r = post(ctx, JSONObject()
            .put("action", "android_registrar")
            .put("fcm_token", fcmToken)
            .put("fcm_project", Config.projectId(ctx))
            .put("modelo", "${Build.MANUFACTURER} ${Build.MODEL}")
            .put("android", Build.VERSION.RELEASE)
            .put("app", BuildConfigVersao.NOME))
        return r?.optBoolean("ok") == true
    }

    fun ack(ctx: Context, id: String, estado: String, detalhe: String): Boolean {
        val r = post(ctx, JSONObject()
            .put("action", "android_ack").put("id", id).put("estado", estado).put("detalhe", detalhe))
        return r?.optBoolean("ok") == true
    }
}

/** A versão do app, sem depender do BuildConfig (desligado por padrão nas versões novas do AGP). */
object BuildConfigVersao { const val NOME = "0.5.3-nova-cara" }
