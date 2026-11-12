package dev.jarvis.companion

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.LruCache
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/**
 * Fotos, vídeos e links de um assunto no chat do app (0.16.1). O servidor (Midia.js) devolve `§MIDIA§` + JSON quando o chat ESCRITO pede
 * "me mostra fotos/vídeos de X"; aqui se lê esse JSON e se baixam as miniaturas. Sem biblioteca de imagem: HttpURLConnection + BitmapFactory,
 * com cache em memória. SÓ baixa de i.ytimg.com (capa de vídeo) e upload.wikimedia.org: qualquer outro endereço é ignorado.
 */
object Midia {
    const val PREFIXO = "§MIDIA§"

    class Video(val titulo: String, val canal: String, val url: String, val capa: String)
    class Foto(val legenda: String, val img: String, val pagina: String)
    class Link(val rotulo: String, val url: String)
    class Dados(val termo: String, val resumo: String, val fonteResumo: String, val pediuVideos: Boolean, val pediuFotos: Boolean,
                val semChave: Boolean, val videos: List<Video>, val fotos: List<Foto>, val links: List<Link>)

    fun ler(texto: String): Dados? = try {
        val j = JSONObject(texto.removePrefix(PREFIXO))
        fun <T> lista(nome: String, f: (JSONObject) -> T?): List<T> { val a = j.optJSONArray(nome) ?: return emptyList(); return (0 until a.length()).mapNotNull { f(a.getJSONObject(it)) } }
        Dados(j.optString("termo"), j.optString("resumo"), linkSeguro(j.optString("fonteResumo")), j.optBoolean("pediuVideos"), j.optBoolean("pediuFotos"), j.optBoolean("semChave"),
            lista("videos") { o -> if (linkSeguro(o.optString("url")).isEmpty()) null else Video(o.optString("titulo"), o.optString("canal"), o.optString("url"), o.optString("capa")) },
            lista("fotos") { o -> if (!imagemPermitida(o.optString("img"))) null else Foto(o.optString("legenda"), o.optString("img"), linkSeguro(o.optString("pagina"))) },
            lista("links") { o -> if (linkSeguro(o.optString("url")).isEmpty()) null else Link(o.optString("rotulo"), o.optString("url")) })
    } catch (e: Exception) { null }

    fun imagemPermitida(u: String): Boolean = try {
        val x = URL(u); x.protocol == "https" && (x.host == "i.ytimg.com" || x.host == "upload.wikimedia.org")
    } catch (e: Exception) { false }

    fun linkSeguro(u: String): String = if (u.startsWith("https://")) u else ""

    private val cache = object : LruCache<String, Bitmap>(12 * 1024 * 1024) { override fun sizeOf(k: String, b: Bitmap) = b.byteCount }

    fun emCache(u: String): Bitmap? = cache.get(u)

    /** Baixa a miniatura (chamar fora da thread principal). null = endereço fora da lista, rede ou imagem inválida. */
    fun baixar(u: String): Bitmap? {
        if (!imagemPermitida(u)) return null
        cache.get(u)?.let { return it }
        return try {
            val c = URL(u).openConnection() as HttpURLConnection
            c.connectTimeout = 8000; c.readTimeout = 10000; c.instanceFollowRedirects = false
            c.setRequestProperty("User-Agent", "JarvisCompanion/0.16 (uso pessoal)")
            if (c.responseCode != 200) { c.disconnect(); return null }
            val bytes = c.inputStream.use { it.readBytes() }; c.disconnect()
            if (bytes.size > 3_000_000) return null
            val op = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            BitmapFactory.decodeByteArray(bytes, 0, bytes.size, op)
            var amostra = 1; while (op.outWidth / amostra > 720) amostra *= 2
            BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply { inSampleSize = amostra })?.also { cache.put(u, it) }
        } catch (e: Exception) { null }
    }
}
