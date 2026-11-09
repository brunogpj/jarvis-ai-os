package dev.jarvis.companion

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.drawable.GradientDrawable
import android.view.View

/** Paleta e peças visuais da nova cara (0.5.0). A identidade é a de sempre (fundo escuro, ciano); o que muda é a hierarquia. */
object Cores {
    val FUNDO = Color.parseColor("#0d0f1e")
    val BARRA = Color.parseColor("#0b0d1a")
    val CARTAO = Color.parseColor("#131834")
    val BORDA = Color.parseColor("#232b52")
    val DIVISOR = Color.parseColor("#1c2142")
    val TEXTO = Color.parseColor("#e8ebf7")
    val TEXTO2 = Color.parseColor("#c9cde4")
    val SECUNDARIO = Color.parseColor("#9aa3c4")      // 6:1 sobre o fundo; nunca mais claro que isso para rótulo pequeno
    val DESTAQUE = Color.parseColor("#22d3d3")
    val BALAO_VOCE = Color.parseColor("#1d2447")
    val OK = Color.parseColor("#3ddc97")
    val ATENCAO = Color.parseColor("#ffb454")
}

fun Context.dp(v: Int): Int = (v * resources.displayMetrics.density + 0.5f).toInt()

fun fundoArredondado(cor: Int, raio: Float, borda: Int = 0, larguraBorda: Int = 0): GradientDrawable =
    GradientDrawable().apply {
        setColor(cor); cornerRadius = raio
        if (borda != 0) setStroke(larguraBorda, borda)
    }

/** O orbe do ícone, pequeno, ao lado do título. */
class MarcaView(ctx: Context) : View(ctx) {
    private val p = Paint(Paint.ANTI_ALIAS_FLAG)
    override fun onDraw(c: Canvas) {
        val w = width.toFloat()
        val k = w / 108f
        p.style = Paint.Style.FILL; p.color = Color.parseColor("#151a30")
        c.drawRoundRect(RectF(0f, 0f, w, w), 26f * k, 26f * k, p)
        p.style = Paint.Style.STROKE; p.color = Cores.DESTAQUE; p.strokeWidth = 5f * k
        c.drawCircle(w / 2, w / 2, 24f * k, p)
        p.color = Color.parseColor("#8cecec"); p.alpha = 140; p.strokeWidth = 3f * k
        c.drawCircle(w / 2, w / 2, 16f * k, p)
        p.alpha = 255; p.style = Paint.Style.FILL; p.color = Cores.DESTAQUE
        c.drawCircle(w / 2, w / 2, 8f * k, p)
    }
}

/** O botão principal: um orbe de 132 dp com microfone. Anel externo suave, anel de destaque, miolo escuro. */
class OrbeView(ctx: Context) : View(ctx) {
    private val p = Paint(Paint.ANTI_ALIAS_FLAG)
    init { isClickable = true; isFocusable = true; contentDescription = "Falar com o Jarvis" }

    override fun onDraw(c: Canvas) {
        val cx = width / 2f; val cy = height / 2f
        val d = resources.displayMetrics.density
        val r = 66f * d
        p.style = Paint.Style.FILL; p.color = Cores.DESTAQUE; p.alpha = 38
        c.drawCircle(cx, cy, r + 10f * d, p)
        p.alpha = 255; p.color = Color.parseColor("#0f1a30")
        c.drawCircle(cx, cy, r, p)
        p.style = Paint.Style.STROKE; p.strokeWidth = 3f * d; p.color = if (isPressed) Color.WHITE else Cores.DESTAQUE
        c.drawCircle(cx, cy, r - 1.5f * d, p)
        // microfone
        p.color = Cores.DESTAQUE; p.strokeWidth = 3.4f * d; p.strokeCap = Paint.Cap.ROUND
        val capsula = RectF(cx - 11f * d, cy - 30f * d, cx + 11f * d, cy + 8f * d)
        c.drawRoundRect(capsula, 11f * d, 11f * d, p)
        c.drawArc(RectF(cx - 22f * d, cy - 14f * d, cx + 22f * d, cy + 22f * d), 0f, 180f, false, p)
        c.drawLine(cx, cy + 22f * d, cx, cy + 32f * d, p)
    }

    override fun setPressed(pressed: Boolean) { super.setPressed(pressed); invalidate() }
}

/** Balão de conversa: cantos com raios diferentes (o "bico" fica no canto de quem fala). `raios` = 8 valores, dois por canto. */
fun GradientDrawableCantos(cor: Int, raios: FloatArray, borda: Int = 0): GradientDrawable =
    GradientDrawable().apply {
        setColor(cor); cornerRadii = raios
        if (borda != 0) setStroke(1, borda)
    }

/** Ícones de contorno da barra inferior (mesmo traço de 1,8 dp da proposta). tipo: 0 conversa, 1 sistema, 2 voz. */
class IconeAbaView(ctx: Context, private val tipo: Int) : View(ctx) {
    var cor: Int = Cores.SECUNDARIO
        set(v) { field = v; invalidate() }
    private val p = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE; strokeCap = Paint.Cap.ROUND; strokeJoin = Paint.Join.ROUND
    }

    override fun onDraw(c: Canvas) {
        val k = width / 24f
        p.color = cor; p.strokeWidth = 1.8f * k
        val path = android.graphics.Path()
        when (tipo) {
            0 -> { // balão de conversa
                path.moveTo(21f * k, 12f * k)
                path.cubicTo(21f * k, 16.4f * k, 16.97f * k, 20f * k, 12f * k, 20f * k)
                path.cubicTo(10.7f * k, 20f * k, 9.5f * k, 19.8f * k, 9.4f * k, 19.1f * k)
                path.lineTo(4f * k, 20f * k); path.lineTo(5f * k, 15.4f * k)
                path.cubicTo(3.7f * k, 14.2f * k, 3f * k, 13.2f * k, 3f * k, 12f * k)
                path.cubicTo(3f * k, 7.6f * k, 7.03f * k, 4f * k, 12f * k, 4f * k)
                path.cubicTo(16.97f * k, 4f * k, 21f * k, 7.6f * k, 21f * k, 12f * k)
            }
            1 -> { // pulso
                path.moveTo(3f * k, 12f * k); path.lineTo(7f * k, 12f * k); path.lineTo(10f * k, 20f * k)
                path.lineTo(14f * k, 4f * k); path.lineTo(17f * k, 12f * k); path.lineTo(21f * k, 12f * k)
            }
            else -> { // barras de equalizador
                path.moveTo(4f * k, 8f * k); path.lineTo(4f * k, 16f * k)
                path.moveTo(8f * k, 5f * k); path.lineTo(8f * k, 19f * k)
                path.moveTo(12f * k, 9f * k); path.lineTo(12f * k, 15f * k)
                path.moveTo(16f * k, 6f * k); path.lineTo(16f * k, 18f * k)
                path.moveTo(20f * k, 10f * k); path.lineTo(20f * k, 14f * k)
            }
        }
        c.drawPath(path, p)
    }
}

/** Barras que acompanham o volume da voz na tela "Ouvindo". */
class OndaView(ctx: Context) : View(ctx) {
    private val niveis = FloatArray(9) { 0.15f }
    private val p = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Cores.DESTAQUE; strokeCap = Paint.Cap.ROUND }

    /** nivel: 0..1. Empurra as barras para a esquerda e põe o novo valor na direita. */
    fun empurrar(nivel: Float) {
        for (i in 0 until niveis.size - 1) niveis[i] = niveis[i + 1]
        niveis[niveis.size - 1] = nivel.coerceIn(0.1f, 1f)
        invalidate()
    }

    override fun onDraw(c: Canvas) {
        val d = resources.displayMetrics.density
        val larg = 6f * d; val folga = 6f * d
        val total = niveis.size * larg + (niveis.size - 1) * folga
        var x = (width - total) / 2f + larg / 2f
        p.strokeWidth = larg
        for (n in niveis) {
            val h = (height * (0.22f + 0.78f * n)) / 2f
            p.alpha = (110 + 145 * n).toInt()
            c.drawLine(x, height / 2f - h, x, height / 2f + h, p)
            x += larg + folga
        }
    }
}
