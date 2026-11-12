package dev.jarvis.companion.ui

import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import dev.jarvis.companion.Midia
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

private fun abrir(ctx: Context, url: String) {
    if (!url.startsWith("https://")) return
    try { ctx.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) } catch (_: Exception) {}
}

/** Miniatura baixada fora da thread principal; enquanto carrega (ou se falhar) mostra um fundo neutro com o ícone. */
@Composable
private fun Miniatura(url: String, modifier: Modifier, icone: String = "") {
    val bmp by produceState<Bitmap?>(Midia.emCache(url), url) { if (value == null) value = withContext(Dispatchers.IO) { Midia.baixar(url) } }
    Box(modifier.background(Paleta.CartaoAlto), contentAlignment = Alignment.Center) {
        val b = bmp
        if (b != null) Image(b.asImageBitmap(), contentDescription = null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
        if (icone.isNotEmpty()) Box(Modifier.size(40.dp).clip(RoundedCornerShape(20.dp)).background(Color(0xAA000000)), contentAlignment = Alignment.Center) {
            Text(icone, color = Color.White, style = MaterialTheme.typography.titleMedium)
        }
    }
}

/** Resposta de "me mostra fotos/vídeos de X": resumo com fonte, vídeos com capa, fotos em fileira e os links prontos do Google. Tudo abre fora do app. */
@Composable
fun CartaoMidia(m: Msg) {
    val ctx = LocalContext.current
    val d = remember(m.texto) { Midia.ler(m.texto) }
    if (d == null) { Text("Não consegui mostrar essa resposta.", color = Paleta.Secundario); return }
    val forma = RoundedCornerShape(6.dp, 20.dp, 20.dp, 20.dp)
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.Top) {
        Orbe(28.dp, Modifier.padding(top = 4.dp))
        Spacer(Modifier.width(8.dp))
        Column(Modifier.weight(1f).clip(forma).background(Paleta.Cartao).border(1.dp, Paleta.Borda, forma).padding(14.dp)) {
            Text(d.termo.replaceFirstChar { it.uppercase() }, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold, color = Paleta.Texto)
            if (d.resumo.isNotBlank()) {
                Spacer(Modifier.height(6.dp))
                Text(d.resumo, style = MaterialTheme.typography.bodyMedium, color = Paleta.Texto2)
                if (d.fonteResumo.isNotEmpty()) Text("Fonte: Wikipédia ↗", style = MaterialTheme.typography.bodySmall, color = Paleta.Destaque,
                    modifier = Modifier.padding(top = 4.dp).clickable { abrir(ctx, d.fonteResumo) })
            }
            if (d.pediuVideos) {
                Secao("Vídeos")
                if (d.videos.isEmpty()) Text(if (d.semChave) "A busca de vídeos precisa da chave do YouTube. Use o botão YouTube abaixo." else "Não achei vídeos agora. Use o botão YouTube abaixo.",
                    style = MaterialTheme.typography.bodySmall, color = Paleta.Secundario)
                d.videos.forEach { v ->
                    Column(Modifier.fillMaxWidth().padding(bottom = 10.dp).clip(RoundedCornerShape(14.dp)).clickable { abrir(ctx, v.url) }) {
                        Miniatura(v.capa, Modifier.fillMaxWidth().aspectRatio(16f / 9f).clip(RoundedCornerShape(14.dp)), "▶")
                        Text(v.titulo, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium, color = Paleta.Texto, maxLines = 2, overflow = TextOverflow.Ellipsis,
                            modifier = Modifier.padding(top = 6.dp))
                        if (v.canal.isNotBlank()) Text(v.canal, style = MaterialTheme.typography.bodySmall, color = Paleta.Secundario)
                    }
                }
            }
            if (d.pediuFotos) {
                Secao("Fotos")
                if (d.fotos.isEmpty()) Text("A Wikipédia não tem imagem para isso. Use o botão Imagens abaixo.", style = MaterialTheme.typography.bodySmall, color = Paleta.Secundario)
                else Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    d.fotos.forEach { f ->
                        Column(Modifier.width(150.dp).clickable { abrir(ctx, f.pagina.ifEmpty { f.img }) }) {
                            Miniatura(f.img, Modifier.width(150.dp).height(110.dp).clip(RoundedCornerShape(12.dp)))
                            Text(f.legenda, style = MaterialTheme.typography.bodySmall, color = Paleta.Secundario, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 4.dp))
                        }
                    }
                }
            }
            Secao("No Google")
            Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                d.links.forEach { l -> Pilula(l.rotulo + " ↗", onClick = { abrir(ctx, l.url) }, destaque = l.rotulo == "Imagens") }
            }
        }
    }
}

@Composable
private fun Secao(t: String) {
    Text(t, style = MaterialTheme.typography.labelLarge, color = Paleta.Secundario, modifier = Modifier.padding(top = 14.dp, bottom = 8.dp))
}
