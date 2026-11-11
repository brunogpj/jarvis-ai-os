package dev.jarvis.companion.ui

import android.content.Context
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontVariation
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

/**
 * Tema do app em Compose (0.11.0). A identidade é a de sempre (fundo azul-noite, ciano), com a hierarquia do Material 3:
 * superfícies em camadas (fundo → cartão → cartão alto), bordas finas e o ciano reservado para o que é ação ou estado.
 */
object Paleta {
    val Fundo = Color(0xFF0B0D1A)
    val Superficie = Color(0xFF0F1226)
    val Cartao = Color(0xFF141939)
    val CartaoAlto = Color(0xFF1A2147)
    val Borda = Color(0xFF252D58)
    val Divisor = Color(0xFF1C2142)
    val Texto = Color(0xFFE8EBF7)
    val Texto2 = Color(0xFFC9CDE4)
    val Secundario = Color(0xFF9AA3C4)      // 6:1 sobre o fundo: o mais claro que um rótulo pequeno precisa ser
    val Destaque = Color(0xFF22D3D3)
    val DestaqueSuave = Color(0xFF0F2A33)
    val BalaoVoce = Color(0xFF1D2447)
    val Ok = Color(0xFF3DDC97)
    val OkFundo = Color(0xFF10291F)
    val Atencao = Color(0xFFFFB454)
    val AtencaoFundo = Color(0xFF2A2113)
    val Erro = Color(0xFFFF6B6B)
}

/** Fontes embutidas (Space Grotesk nos títulos, Inter no corpo; variáveis, licença OFL em assets/fonts). Sem a variação, cai na fonte do sistema. */
class Fontes(val corpo: FontFamily, val titulo: FontFamily)

private fun familia(ctx: Context, arquivo: String): FontFamily = try {
    FontFamily(listOf(400, 500, 600, 700).map { w ->
        Font("fonts/$arquivo", ctx.assets, FontWeight(w), FontStyle.Normal, FontVariation.Settings(FontVariation.weight(w)))
    })
} catch (e: Exception) { FontFamily.Default }

@Composable
fun JarvisTema(conteudo: @Composable () -> Unit) {
    val ctx = LocalContext.current
    val f = remember { Fontes(familia(ctx, "Inter.ttf"), familia(ctx, "SpaceGrotesk.ttf")) }
    val tipos = remember {
        Typography(
            displaySmall = TextStyle(fontFamily = f.titulo, fontWeight = FontWeight.Bold, fontSize = 34.sp, lineHeight = 38.sp),
            headlineMedium = TextStyle(fontFamily = f.titulo, fontWeight = FontWeight.Bold, fontSize = 28.sp, lineHeight = 32.sp),
            headlineSmall = TextStyle(fontFamily = f.titulo, fontWeight = FontWeight.SemiBold, fontSize = 22.sp, lineHeight = 28.sp),
            titleLarge = TextStyle(fontFamily = f.titulo, fontWeight = FontWeight.Bold, fontSize = 24.sp),
            titleMedium = TextStyle(fontFamily = f.titulo, fontWeight = FontWeight.Medium, fontSize = 17.sp),
            bodyLarge = TextStyle(fontFamily = f.corpo, fontWeight = FontWeight.Normal, fontSize = 16.sp, lineHeight = 23.sp),
            bodyMedium = TextStyle(fontFamily = f.corpo, fontWeight = FontWeight.Normal, fontSize = 14.sp, lineHeight = 20.sp),
            bodySmall = TextStyle(fontFamily = f.corpo, fontWeight = FontWeight.Normal, fontSize = 12.sp, lineHeight = 16.sp),
            labelLarge = TextStyle(fontFamily = f.corpo, fontWeight = FontWeight.SemiBold, fontSize = 14.sp),
            labelMedium = TextStyle(fontFamily = f.corpo, fontWeight = FontWeight.Medium, fontSize = 12.sp),
            labelSmall = TextStyle(fontFamily = f.corpo, fontWeight = FontWeight.Medium, fontSize = 11.sp, letterSpacing = 0.8.sp)
        )
    }
    MaterialTheme(
        colorScheme = darkColorScheme(
            primary = Paleta.Destaque, onPrimary = Paleta.Fundo,
            background = Paleta.Fundo, onBackground = Paleta.Texto,
            surface = Paleta.Superficie, onSurface = Paleta.Texto,
            surfaceVariant = Paleta.Cartao, onSurfaceVariant = Paleta.Secundario,
            outline = Paleta.Borda, error = Paleta.Erro
        ),
        typography = tipos,
        content = conteudo
    )
}
