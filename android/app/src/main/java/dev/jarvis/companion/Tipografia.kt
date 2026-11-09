package dev.jarvis.companion

import android.content.Context
import android.graphics.Typeface

/**
 * Fontes embutidas (0.5.1): Space Grotesk nos títulos e Inter no corpo, ambas variáveis (licença OFL, texto em assets/fonts).
 * O peso sai do eixo `wght`; se o aparelho não aplicar a variação, cai na fonte do sistema (o app nunca fica sem texto).
 */
object Tipografia {
    private val cache = HashMap<String, Typeface>()

    @Synchronized
    private fun carregar(ctx: Context, arquivo: String, peso: Int): Typeface {
        val chave = "$arquivo/$peso"
        cache[chave]?.let { return it }
        val t = try {
            Typeface.Builder(ctx.applicationContext.assets, "fonts/$arquivo")
                .setFontVariationSettings("'wght' $peso")
                .build()
        } catch (e: Exception) { null } ?: Typeface.DEFAULT
        cache[chave] = t
        return t
    }

    fun inter(ctx: Context, peso: Int = 400): Typeface = carregar(ctx, "Inter.ttf", peso)
    fun grotesk(ctx: Context, peso: Int = 500): Typeface = carregar(ctx, "SpaceGrotesk.ttf", peso)
}
