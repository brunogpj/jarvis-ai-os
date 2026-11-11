package dev.jarvis.companion.ui

import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/** Peças reutilizadas pelas três telas. */

@Composable
fun Cartao(titulo: String, modifier: Modifier = Modifier, selo: String? = null, seloBom: Boolean = true, conteudo: @Composable ColumnScope.() -> Unit) {
    Column(
        modifier.fillMaxWidth()
            .clip(RoundedCornerShape(20.dp))
            .background(Paleta.Cartao)
            .border(1.dp, Paleta.Borda, RoundedCornerShape(20.dp))
            .padding(horizontal = 18.dp, vertical = 16.dp)
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(titulo, style = MaterialTheme.typography.titleMedium, color = Paleta.Texto, modifier = Modifier.weight(1f))
            if (selo != null) SeloChip(selo, seloBom)
        }
        Spacer(Modifier.height(6.dp))
        conteudo()
    }
}

@Composable
fun SeloChip(texto: String, bom: Boolean) {
    val cor = if (bom) Paleta.Ok else Paleta.Atencao
    Row(
        Modifier.clip(CircleShape).background(if (bom) Paleta.OkFundo else Paleta.AtencaoFundo).padding(horizontal = 10.dp, vertical = 5.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Box(Modifier.size(6.dp).clip(CircleShape).background(cor))
        Spacer(Modifier.width(6.dp))
        Text(texto, style = MaterialTheme.typography.labelMedium, color = cor)
    }
}

@Composable
fun LinhaInfo(rotulo: String, valor: String, valorCor: Color = Paleta.Texto) {
    Row(Modifier.fillMaxWidth().padding(vertical = 6.dp), verticalAlignment = Alignment.Top) {
        Text(rotulo, style = MaterialTheme.typography.bodyMedium, color = Paleta.Secundario, modifier = Modifier.weight(1.15f))
        Spacer(Modifier.width(10.dp))
        Text(valor, style = MaterialTheme.typography.bodyMedium, color = valorCor, textAlign = TextAlign.End, modifier = Modifier.weight(1f))
    }
}

@Composable
fun Divisor() { Box(Modifier.fillMaxWidth().height(1.dp).background(Paleta.Divisor)) }

@Composable
fun Subtitulo(texto: String) {
    Text(texto.uppercase(), style = MaterialTheme.typography.labelSmall, color = Paleta.Secundario, modifier = Modifier.padding(top = 12.dp, bottom = 2.dp))
}

/** O orbe da marca: dois anéis e um miolo. Com `pulsando` respira (usado quando o Jarvis está pensando ou falando). */
@Composable
fun Orbe(tamanho: Dp, modifier: Modifier = Modifier, pulsando: Boolean = false) {
    val t = rememberInfiniteTransition(label = "orbe")
    val pulso by t.animateFloat(0f, 1f, infiniteRepeatable(tween(1500), RepeatMode.Reverse), label = "pulso")
    val k = if (pulsando) pulso else 0f
    Canvas(modifier.size(tamanho)) {
        val w = size.minDimension
        val c = Offset(w / 2, w / 2)
        drawCircle(Brush.radialGradient(listOf(Paleta.Destaque.copy(alpha = 0.30f + 0.25f * k), Color.Transparent), center = c, radius = w / 2), radius = w / 2, center = c)
        drawCircle(Paleta.Destaque, radius = w * 0.30f, center = c, style = Stroke(w * 0.05f))
        drawCircle(Color(0xFF8CECEC).copy(alpha = 0.55f), radius = w * 0.19f, center = c, style = Stroke(w * 0.03f))
        drawCircle(Paleta.Destaque, radius = w * 0.085f * (1f + 0.25f * k), center = c)
    }
}

/** Ícones das abas, desenhados (sem biblioteca de ícones): 0 Chat · 1 Dashboard · 2 Dispositivo. */
@Composable
fun IconeAba(indice: Int, modifier: Modifier = Modifier) {
    val cor = LocalContentColor.current
    Canvas(modifier.size(24.dp)) {
        val w = size.minDimension
        val tr = Stroke(w * 0.085f, cap = StrokeCap.Round)
        when (indice) {
            0 -> {
                drawRoundRect(cor, Offset(w * 0.12f, w * 0.16f), Size(w * 0.76f, w * 0.52f), CornerRadius(w * 0.16f), style = tr)
                val p = androidx.compose.ui.graphics.Path().apply {
                    moveTo(w * 0.34f, w * 0.68f); lineTo(w * 0.30f, w * 0.88f); lineTo(w * 0.54f, w * 0.68f)
                }
                drawPath(p, cor, style = tr)
            }
            1 -> {
                val l = w * 0.34f; val g = w * 0.12f; val m = w * 0.1f
                for (i in 0..1) for (j in 0..1) drawRoundRect(cor, Offset(m + i * (l + g), m + j * (l + g)), Size(l, l), CornerRadius(w * 0.08f), style = tr)
            }
            else -> {
                drawRoundRect(cor, Offset(w * 0.27f, w * 0.08f), Size(w * 0.46f, w * 0.84f), CornerRadius(w * 0.12f), style = tr)
                drawLine(cor, Offset(w * 0.42f, w * 0.78f), Offset(w * 0.58f, w * 0.78f), strokeWidth = w * 0.085f, cap = StrokeCap.Round)
            }
        }
    }
}

/** Pílula de ação. `destaque` = preenchida em ciano; senão contorno. Segurar (onLongClick) é opcional. */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun Pilula(texto: String, onClick: () -> Unit, modifier: Modifier = Modifier, destaque: Boolean = false, onLongClick: (() -> Unit)? = null) {
    val forma = RoundedCornerShape(24.dp)
    Box(
        modifier.clip(forma)
            .background(if (destaque) Paleta.Destaque else Paleta.Cartao)
            .border(1.dp, if (destaque) Paleta.Destaque else Paleta.Borda, forma)
            .combinedClickable(onClick = onClick, onLongClick = onLongClick)
            .padding(horizontal = 16.dp, vertical = 11.dp),
        contentAlignment = Alignment.Center
    ) {
        Text(texto, style = MaterialTheme.typography.labelLarge, color = if (destaque) Paleta.Fundo else Paleta.Texto2)
    }
}

/** Botão redondo (microfone, enviar). */
@Composable
fun BotaoRedondo(rotulo: String, descricao: String, onClick: () -> Unit, preenchido: Boolean = false) {
    Box(
        Modifier.size(48.dp).clip(CircleShape)
            .background(if (preenchido) Paleta.Destaque else Paleta.BalaoVoce)
            .border(1.dp, if (preenchido) Paleta.Destaque else Paleta.Borda, CircleShape)
            .combinedClickableSimples(onClick),
        contentAlignment = Alignment.Center
    ) {
        Text(rotulo, style = MaterialTheme.typography.titleMedium, color = if (preenchido) Paleta.Fundo else Paleta.Destaque)
    }
}

@OptIn(ExperimentalFoundationApi::class)
private fun Modifier.combinedClickableSimples(onClick: () -> Unit): Modifier = this.combinedClickable(onClick = onClick)

@Composable
fun Coluna(modifier: Modifier = Modifier, conteudo: @Composable ColumnScope.() -> Unit) {
    Column(modifier, verticalArrangement = Arrangement.spacedBy(14.dp), content = conteudo)
}
