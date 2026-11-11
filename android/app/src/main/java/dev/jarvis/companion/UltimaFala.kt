package dev.jarvis.companion

import android.content.Context
import android.content.Intent
import androidx.core.content.ContextCompat
import java.io.File

/**
 * A última fala do Jarvis, guardada no aparelho para ouvir de novo (0.13.0). Vale para TUDO que o app fala: resposta de conversa, briefing, aviso
 * proativo. Quando a fala veio como áudio (voz premium da nuvem), o ARQUIVO fica guardado, porque o do Drive é sobrescrito a cada fala e não dá
 * para baixar de novo; quando veio como texto (voz do celular), guarda-se o texto. Só a última, só neste celular (o texto pode ter valores da
 * caderneta), sobrescrita a cada fala nova. Exemplos de fala de teste (amostra da voz) não entram.
 */
object UltimaFala {
    private fun arquivoAudio(ctx: Context) = File(ctx.filesDir, "ultima_fala.audio")

    @Synchronized
    fun registrar(ctx: Context, texto: String, audio: File?) {
        try {
            if (audio != null && audio.exists()) audio.copyTo(arquivoAudio(ctx), overwrite = true) else arquivoAudio(ctx).delete()
        } catch (_: Exception) { try { arquivoAudio(ctx).delete() } catch (_: Exception) {} }
        Config.estado(ctx).edit().putString("ultima_fala_texto", texto.take(1500)).putLong("ultima_fala_em", System.currentTimeMillis()).apply()
    }

    fun texto(ctx: Context): String = Config.estado(ctx).getString("ultima_fala_texto", "") ?: ""
    fun em(ctx: Context): Long = Config.estado(ctx).getLong("ultima_fala_em", 0L)
    fun existe(ctx: Context): Boolean = texto(ctx).isNotBlank() || arquivo(ctx) != null

    /** O áudio guardado, se a última fala veio como áudio. */
    fun arquivo(ctx: Context): File? = arquivoAudio(ctx).takeIf { it.exists() && it.length() > 200 }

    /** Fala de novo. Sem `texto`: a última fala (com o áudio original, se houver). Com `texto`: aquele texto, pela voz do celular. */
    fun repetir(ctx: Context, texto: String? = null) {
        val i = Intent(ctx, FalaService::class.java).putExtra("id", "r" + System.currentTimeMillis().toString(36)).putExtra("repetir", true)
        if (!texto.isNullOrBlank()) i.putExtra("texto", texto)
        ContextCompat.startForegroundService(ctx, i)
    }
}
