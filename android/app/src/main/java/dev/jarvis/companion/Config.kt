package dev.jarvis.companion

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import com.google.firebase.FirebaseApp
import com.google.firebase.FirebaseOptions
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Pareamento do aparelho com o Jarvis. A URL do /exec, o token e a configuração do Firebase NUNCA vêm no código
 * nem no repositório (é público): chegam uma vez, pelo pareamento, e ficam cifrados aqui (Android Keystore).
 *
 * Formato do pareamento (JSON):
 *   { "url": "https://script.google.com/macros/s/.../exec", "token": "...",
 *     "fcm": { "apiKey": "...", "appId": "1:...:android:...", "projectId": "...", "senderId": "..." } }
 */
object Config {
    private const val ARQ_SEGREDO = "jarvis_config"
    private const val ARQ_ESTADO = "jarvis_estado"

    private fun segredo(ctx: Context): SharedPreferences {
        val chave = MasterKey.Builder(ctx).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build()
        return EncryptedSharedPreferences.create(
            ctx, ARQ_SEGREDO, chave,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
        )
    }

    /** Sem segredo: só o que é mostrado na tela e a fila de confirmações pendentes (id + estado). */
    fun estado(ctx: Context): SharedPreferences = ctx.getSharedPreferences(ARQ_ESTADO, Context.MODE_PRIVATE)

    fun url(ctx: Context): String? = segredo(ctx).getString("url", null)
    fun token(ctx: Context): String? = segredo(ctx).getString("token", null)

    /** Projeto do Firebase do pareamento: o app o informa ao Jarvis, que usa para saber de onde mandar o push. */
    fun projectId(ctx: Context): String = segredo(ctx).getString("fcm_projectId", "") ?: ""

    fun pareado(ctx: Context): Boolean =
        !url(ctx).isNullOrBlank() && !token(ctx).isNullOrBlank() && segredo(ctx).getString("fcm_appId", null) != null

    /** Valida e grava o pareamento. Devolve null se deu certo, ou o motivo da recusa. */
    fun salvar(ctx: Context, json: String): String? {
        val o = try { JSONObject(json) } catch (e: Exception) { return "JSON inválido" }
        val url = o.optString("url")
        val token = o.optString("token")
        val f = o.optJSONObject("fcm") ?: return "faltou o bloco fcm"
        if (!url.startsWith("https://script.google.com/")) return "url precisa ser o /exec do Apps Script"
        if (token.length < 20) return "token curto demais"
        for (k in listOf("apiKey", "appId", "projectId", "senderId")) if (f.optString(k).isBlank()) return "faltou fcm.$k"
        segredo(ctx).edit()
            .putString("url", url).putString("token", token)
            .putString("fcm_apiKey", f.getString("apiKey")).putString("fcm_appId", f.getString("appId"))
            .putString("fcm_projectId", f.getString("projectId")).putString("fcm_senderId", f.getString("senderId"))
            .apply()
        return null
    }

    /** Inicia o Firebase com a configuração do pareamento (sem o plugin google-services). Seguro chamar várias vezes. */
    fun iniciarFirebase(ctx: Context): Boolean {
        if (!pareado(ctx)) return false
        if (FirebaseApp.getApps(ctx).isNotEmpty()) return true
        val s = segredo(ctx)
        val opcoes = FirebaseOptions.Builder()
            .setApiKey(s.getString("fcm_apiKey", "")!!)
            .setApplicationId(s.getString("fcm_appId", "")!!)
            .setProjectId(s.getString("fcm_projectId", "")!!)
            .setGcmSenderId(s.getString("fcm_senderId", "")!!)
            .build()
        FirebaseApp.initializeApp(ctx, opcoes)
        return true
    }

    // ---- diário curto para a tela de status (sem segredo) ----
    private val hora = SimpleDateFormat("dd/MM HH:mm:ss", Locale("pt", "BR"))

    @Synchronized
    fun evento(ctx: Context, texto: String) {
        val p = estado(ctx)
        val linhas = (p.getString("eventos", "") ?: "").split("\n").filter { it.isNotBlank() }.toMutableList()
        linhas.add(0, "${hora.format(Date())}  $texto")
        p.edit().putString("eventos", linhas.take(8).joinToString("\n")).apply()
    }

    fun eventos(ctx: Context): String = estado(ctx).getString("eventos", "") ?: ""
}
