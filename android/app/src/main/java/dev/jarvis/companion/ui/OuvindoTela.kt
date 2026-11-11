package dev.jarvis.companion.ui

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.mutableStateListOf
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
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlin.math.PI
import kotlin.math.sin

/** Em que pé está a conversa: o orbe muda de cor e de movimento em cada fase. */
enum class Fase(val rotulo: String, val cor: Color) {
    OUVINDO("OUVINDO", Color(0xFF22D3D3)),
    PENSANDO("PENSANDO", Color(0xFFA796FF)),
    FALANDO("FALANDO", Color(0xFF3DDC97)),
    NADA("NÃO OUVI NADA", Color(0xFFFFB454))
}

class EstadoOuvindo {
    var fase by mutableStateOf(Fase.OUVINDO)
    var frase by mutableStateOf("")
    var resposta by mutableStateOf("")
    var dica by mutableStateOf("Fale normalmente. Toque no quadrado quando terminar.")
    var nivel by mutableFloatStateOf(0f)
    val barras = mutableStateListOf<Float>()

    fun empurrar(v: Float) {
        val n = v.coerceIn(0f, 1f)
        nivel = n
        barras.add(n)
        while (barras.size > 30) barras.removeAt(0)
    }
}

@Composable
fun OuvindoTela(e: EstadoOuvindo, aoParar: () -> Unit, aoFechar: () -> Unit, aoRepetir: () -> Unit = {}) {
    val cor = e.fase.cor
    val corAnim by androidx.compose.animation.animateColorAsState(cor, tween(350), label = "cor")
    Box(Modifier.fillMaxSize().background(Paleta.Fundo)) {
        // brilho de fundo na cor da fase
        Canvas(Modifier.fillMaxSize()) {
            drawCircle(Brush.radialGradient(listOf(corAnim.copy(alpha = 0.16f), Color.Transparent), center = Offset(size.width / 2, size.height * 0.38f), radius = size.width * 0.95f),
                radius = size.width * 0.95f, center = Offset(size.width / 2, size.height * 0.38f))
        }
        Column(Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding().padding(horizontal = 28.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Spacer(Modifier.height(28.dp))
            // selo da fase
            Row(Modifier.clip(CircleShape).background(corAnim.copy(alpha = 0.14f)).padding(horizontal = 14.dp, vertical = 7.dp), verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(7.dp).clip(CircleShape).background(corAnim))
                Spacer(Modifier.width(8.dp))
                Text(e.fase.rotulo, style = MaterialTheme.typography.labelSmall, color = corAnim)
            }

            Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.Center) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    OrbeFase(e, Modifier.size(260.dp))
                    Spacer(Modifier.height(20.dp))
                    when (e.fase) {
                        Fase.FALANDO -> Box(Modifier.heightIn(max = 190.dp).verticalScroll(rememberScrollState())) {
                            Text(e.resposta.ifBlank { "…" }, style = MaterialTheme.typography.headlineSmall, color = Paleta.Texto, textAlign = TextAlign.Center)
                        }
                        else -> Text(e.frase, style = MaterialTheme.typography.headlineMedium.copy(fontSize = 26.sp), color = Paleta.Texto, textAlign = TextAlign.Center, minLines = 2, maxLines = 4)
                    }
                    Spacer(Modifier.height(16.dp))
                    Barras(e, corAnim)
                    Spacer(Modifier.height(10.dp))
                    Text(e.dica, style = MaterialTheme.typography.bodyMedium, color = Paleta.Secundario, textAlign = TextAlign.Center)
                }
            }

            // rodapé: parar (ouvindo) ou fechar
            if (e.fase == Fase.OUVINDO) {
                Box(
                    Modifier.size(84.dp).clip(CircleShape).background(corAnim).clickable(onClickLabel = "Parar de ouvir") { aoParar() },
                    contentAlignment = Alignment.Center
                ) { Box(Modifier.size(26.dp).clip(RoundedCornerShape(6.dp)).background(Paleta.Fundo)) }
                Spacer(Modifier.height(8.dp))
            }
            if (e.fase == Fase.FALANDO) {
                Text("🔊 Ouvir de novo", style = MaterialTheme.typography.labelLarge, color = corAnim,
                    modifier = Modifier.clip(RoundedCornerShape(24.dp)).clickable { aoRepetir() }.padding(horizontal = 24.dp, vertical = 12.dp))
            }
            Text(
                if (e.fase == Fase.OUVINDO || e.fase == Fase.NADA) "Cancelar" else "Fechar",
                style = MaterialTheme.typography.labelLarge, color = Paleta.Texto2,
                modifier = Modifier.clip(RoundedCornerShape(24.dp)).clickable { aoFechar() }.padding(horizontal = 24.dp, vertical = 14.dp)
            )
            Spacer(Modifier.height(10.dp))
        }
    }
}

/**
 * O orbe, com um movimento por fase:
 *  · OUVINDO: o miolo cresce com o volume da voz e ondas saem dele.
 *  · PENSANDO: um arco gira ao redor, e o miolo respira devagar.
 *  · FALANDO: o miolo pulsa no ritmo da fala e ondas suaves se afastam.
 */
@Composable
private fun OrbeFase(e: EstadoOuvindo, modifier: Modifier) {
    val t = rememberInfiniteTransition(label = "orbe")
    val giro by t.animateFloat(0f, 360f, infiniteRepeatable(tween(1300, easing = LinearEasing)), label = "giro")
    val onda by t.animateFloat(0f, 1f, infiniteRepeatable(tween(2000, easing = LinearEasing)), label = "onda")
    val respira by t.animateFloat(0f, 1f, infiniteRepeatable(tween(1100), RepeatMode.Reverse), label = "respira")
    val pulso by t.animateFloat(0f, 1f, infiniteRepeatable(tween(420), RepeatMode.Reverse), label = "pulso")
    val nivel by animateFloatAsState(e.nivel, tween(80), label = "nivel")
    val fase = e.fase
    val cor by androidx.compose.animation.animateColorAsState(fase.cor, tween(350), label = "corOrbe")

    Canvas(modifier) {
        val w = size.minDimension
        val c = Offset(w / 2, w / 2)
        val base = w * 0.24f
        // ondas que se afastam (ouvindo e falando)
        if (fase == Fase.OUVINDO || fase == Fase.FALANDO) {
            val forca = if (fase == Fase.OUVINDO) 0.25f + 0.55f * nivel else 0.32f
            for (i in 0..2) {
                val f = (onda + i / 3f) % 1f
                drawCircle(cor.copy(alpha = (1f - f) * forca), radius = base * (1.05f + 1.0f * f), center = c, style = Stroke(w * 0.012f))
            }
        }
        // miolo
        val escala = when (fase) {
            Fase.OUVINDO -> 1f + 0.30f * nivel
            Fase.PENSANDO -> 1f + 0.05f * respira
            Fase.FALANDO -> 1f + 0.12f * (0.5f + 0.5f * sin(pulso * PI.toFloat()))
            Fase.NADA -> 0.92f
        }
        drawCircle(Brush.radialGradient(listOf(cor.copy(alpha = 0.45f), Color.Transparent), center = c, radius = base * 1.9f * escala), radius = base * 1.9f * escala, center = c)
        drawCircle(cor, radius = base * escala, center = c, style = Stroke(w * 0.035f))
        drawCircle(Color.White.copy(alpha = 0.35f), radius = base * 0.66f * escala, center = c, style = Stroke(w * 0.02f))
        drawCircle(cor, radius = base * 0.28f * escala, center = c)
        // arco girando (pensando)
        if (fase == Fase.PENSANDO) {
            val r = base * 1.42f
            drawArc(
                brush = Brush.sweepGradient(listOf(Color.Transparent, cor), center = c),
                startAngle = giro, sweepAngle = 250f, useCenter = false,
                topLeft = Offset(c.x - r, c.y - r), size = Size(r * 2, r * 2), style = Stroke(w * 0.03f, cap = StrokeCap.Round)
            )
        }
    }
}

/** Barras do volume da voz (só ouvindo); nas outras fases ficam como uma linha fina. */
@Composable
private fun Barras(e: EstadoOuvindo, cor: Color) {
    val ouvindo = e.fase == Fase.OUVINDO
    Canvas(Modifier.fillMaxWidth().height(54.dp)) {
        val n = 30
        val gap = 5.dp.toPx()
        val larg = (size.width - gap * (n - 1)) / n
        for (i in 0 until n) {
            val idx = e.barras.size - n + i
            val v = if (ouvindo && idx >= 0) e.barras[idx] else 0f
            val h = (size.height * (0.06f + 0.94f * v)).coerceAtLeast(3.dp.toPx())
            val x = i * (larg + gap)
            drawRoundRect(cor.copy(alpha = if (ouvindo) 0.35f + 0.65f * v else 0.18f), Offset(x, (size.height - h) / 2), Size(larg, h), CornerRadius(larg / 2))
        }
    }
}
