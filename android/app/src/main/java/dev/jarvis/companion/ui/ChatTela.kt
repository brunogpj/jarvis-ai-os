package dev.jarvis.companion.ui

import android.content.Context
import android.content.Intent
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import dev.jarvis.companion.Config
import dev.jarvis.companion.ConversaActivity
import dev.jarvis.companion.Conversa
import dev.jarvis.companion.FalaService
import dev.jarvis.companion.Historico
import dev.jarvis.companion.UltimaFala
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class Msg(val voce: Boolean, val texto: String, val em: Long)

private fun lerMsgs(ctx: Context): List<Msg> {
    val h = Historico.ler(ctx)
    return (0 until h.length()).map { val o = h.getJSONObject(it); Msg(o.optBoolean("v"), o.optString("t"), o.optLong("em")) }
}

/** As três frases das pílulas (segurar para trocar). */
object Atalhos {
    val padrao = listOf("Que horas são", "Quanto tenho livre", "O que vence hoje")
    fun ler(ctx: Context): List<String> = try {
        val j = JSONArray(Config.estado(ctx).getString("atalhos", "") ?: "")
        (0 until 3).map { j.optString(it, "").ifBlank { padrao[it] } }
    } catch (e: Exception) { padrao }
    fun salvar(ctx: Context, indice: Int, frase: String) {
        val j = JSONArray(); ler(ctx).forEachIndexed { i, f -> j.put(if (i == indice) frase.trim() else f) }
        Config.estado(ctx).edit().putString("atalhos", j.toString()).apply()
    }
}

/** Pergunta direta (as pílulas): o mesmo caminho do botão de voz, mas sem a tela de reconhecimento. A resposta sai falada. */
private fun perguntarFalando(ctx: Context, frase: String) {
    val rid = System.currentTimeMillis().toString()
    Config.evento(ctx, "conversa: pedido de ${frase.length} caracteres")
    Config.estado(ctx).edit().putString("ultima_pergunta", frase).putString("ultima_resposta", "(aguardando…)").apply()
    Historico.add(ctx, true, frase)
    ContextCompat.startForegroundService(ctx, Intent(ctx, FalaService::class.java).putExtra("id", "c$rid").putExtra("pergunta", frase).putExtra("rid", rid))
}

@Composable
fun ChatTela(modifier: Modifier = Modifier) {
    val ctx = LocalContext.current
    val escopo = rememberCoroutineScope()
    var msgs by remember { mutableStateOf(lerMsgs(ctx)) }
    var vista by remember { mutableStateOf(Historico.assinatura(ctx)) }
    var aguardando by remember { mutableStateOf(false) }
    var texto by rememberSaveable { mutableStateOf("") }
    var atalhos by remember { mutableStateOf(Atalhos.ler(ctx)) }
    var editando by remember { mutableStateOf(-1) }
    val lista = rememberLazyListState()

    // mensagens que entram pelo microfone, pelas pílulas ou pelos botões da notificação aparecem sozinhas
    LaunchedEffect(Unit) {
        while (true) {
            val a = Historico.assinatura(ctx)
            if (a != vista) { vista = a; msgs = lerMsgs(ctx) }
            delay(1000)
        }
    }
    LaunchedEffect(msgs.size, aguardando) {
        val n = msgs.size + (if (aguardando) 1 else 0)
        if (n > 0) lista.animateScrollToItem(n - 1)
    }

    fun enviar() {
        val frase = texto.trim()
        if (frase.isEmpty() || aguardando) return
        texto = ""
        Historico.add(ctx, true, frase); msgs = lerMsgs(ctx); aguardando = true
        Config.evento(ctx, "chat: pedido de ${frase.length} caracteres")
        val app = ctx.applicationContext
        escopo.launch(Dispatchers.IO) {
            val r = Conversa.perguntarR(app, frase, System.currentTimeMillis().toString())
            Historico.add(app, false, r.texto)
            withContext(Dispatchers.Main) { aguardando = false; msgs = lerMsgs(app) }
        }
    }

    Column(modifier.fillMaxSize()) {
        Box(Modifier.weight(1f).fillMaxWidth()) {
            if (msgs.isEmpty() && !aguardando) {
                Column(Modifier.fillMaxSize().padding(32.dp), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
                    Orbe(96.dp)
                    Spacer(Modifier.height(18.dp))
                    Text("Como posso ajudar?", style = MaterialTheme.typography.headlineSmall, color = Paleta.Texto)
                    Spacer(Modifier.height(6.dp))
                    Text("Escreva, toque no microfone ou use um atalho. Segure um atalho para trocar a frase.", style = MaterialTheme.typography.bodyMedium,
                        color = Paleta.Secundario, textAlign = androidx.compose.ui.text.style.TextAlign.Center)
                }
            } else {
                LazyColumn(state = lista, contentPadding = PaddingValues(horizontal = 16.dp, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    items(msgs) { Balao(it) { t -> UltimaFala.repetir(ctx, t) } }
                    if (aguardando) item { Digitando() }
                }
            }
        }

        Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 6.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            if (UltimaFala.existe(ctx)) Pilula("🔊 Última fala", onClick = { UltimaFala.repetir(ctx) }, destaque = true)
            atalhos.forEachIndexed { i, f -> Pilula(f, onClick = { perguntarFalando(ctx, f) }, onLongClick = { editando = i }) }
        }

        Row(Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, top = 4.dp, bottom = 10.dp), verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedTextField(
                value = texto, onValueChange = { texto = it }, modifier = Modifier.weight(1f),
                placeholder = { Text("Escreva para o Jarvis", color = Paleta.Secundario) },
                shape = RoundedCornerShape(26.dp), maxLines = 4,
                keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences),
                colors = OutlinedTextFieldDefaults.colors(
                    focusedBorderColor = Paleta.Destaque, unfocusedBorderColor = Paleta.Borda, cursorColor = Paleta.Destaque,
                    focusedContainerColor = Paleta.Cartao, unfocusedContainerColor = Paleta.Cartao,
                    focusedTextColor = Paleta.Texto, unfocusedTextColor = Paleta.Texto
                )
            )
            BotaoRedondo("🎙", "Falar com o Jarvis", { ctx.startActivity(Intent(ctx, ConversaActivity::class.java)) })
            BotaoRedondo("↑", "Enviar", { enviar() }, preenchido = true)
        }
    }

    if (editando >= 0) {
        var novo by remember(editando) { mutableStateOf(atalhos[editando]) }
        AlertDialog(
            onDismissRequest = { editando = -1 },
            containerColor = Paleta.CartaoAlto,
            title = { Text("Frase do atalho", color = Paleta.Texto) },
            text = {
                OutlinedTextField(value = novo, onValueChange = { if (it.length <= 40) novo = it }, singleLine = true,
                    colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = Paleta.Destaque, unfocusedBorderColor = Paleta.Borda, focusedTextColor = Paleta.Texto, unfocusedTextColor = Paleta.Texto))
            },
            confirmButton = { TextButton({ Atalhos.salvar(ctx, editando, novo); atalhos = Atalhos.ler(ctx); editando = -1 }) { Text("Salvar", color = Paleta.Destaque) } },
            dismissButton = { TextButton({ editando = -1 }) { Text("Cancelar", color = Paleta.Secundario) } }
        )
    }
}

private val hora = SimpleDateFormat("HH:mm", Locale("pt", "BR"))

@Composable
private fun Balao(m: Msg, aoOuvir: (String) -> Unit) {
    if (m.voce) {
        Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.End) {
            Box(
                Modifier.widthIn(max = 300.dp).clip(RoundedCornerShape(20.dp, 6.dp, 20.dp, 20.dp)).background(Paleta.BalaoVoce)
                    .padding(horizontal = 14.dp, vertical = 10.dp)
            ) { Text(m.texto, style = MaterialTheme.typography.bodyLarge, color = Paleta.Texto) }
            if (m.em > 0) Text(hora.format(Date(m.em)), style = MaterialTheme.typography.bodySmall, color = Paleta.Secundario, modifier = Modifier.padding(top = 2.dp, end = 4.dp))
        }
    } else {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.Top) {
            Orbe(28.dp, Modifier.padding(top = 4.dp))
            Spacer(Modifier.padding(horizontal = 4.dp))
            Column {
                Box(
                    Modifier.widthIn(max = 300.dp).clip(RoundedCornerShape(6.dp, 20.dp, 20.dp, 20.dp)).background(Paleta.Cartao)
                        .border(1.dp, Paleta.Borda, RoundedCornerShape(6.dp, 20.dp, 20.dp, 20.dp)).padding(horizontal = 14.dp, vertical = 10.dp)
                ) { Text(m.texto, style = MaterialTheme.typography.bodyLarge, color = Paleta.Texto) }
                Row(Modifier.padding(top = 2.dp, start = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                    if (m.em > 0) Text(hora.format(Date(m.em)), style = MaterialTheme.typography.bodySmall, color = Paleta.Secundario)
                    Text("  🔊 ouvir", style = MaterialTheme.typography.bodySmall, color = Paleta.Destaque,
                        modifier = Modifier.clip(RoundedCornerShape(10.dp)).clickable { aoOuvir(m.texto) }.padding(horizontal = 6.dp, vertical = 4.dp))
                }
            }
        }
    }
}

@Composable
private fun Digitando() {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Orbe(28.dp, pulsando = true)
        Spacer(Modifier.padding(horizontal = 4.dp))
        Text("Pensando…", style = MaterialTheme.typography.bodyMedium, color = Paleta.Secundario)
    }
}
