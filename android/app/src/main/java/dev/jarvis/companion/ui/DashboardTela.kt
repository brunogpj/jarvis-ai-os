package dev.jarvis.companion.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import dev.jarvis.companion.Painel
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.text.NumberFormat
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale

private val ptBR = Locale("pt", "BR")
fun brl(v: Double?): String = if (v == null || v.isNaN()) "—" else NumberFormat.getCurrencyInstance(ptBR).format(v)
fun JSONArray?.itens(): List<JSONObject> = if (this == null) emptyList() else (0 until length()).mapNotNull { optJSONObject(it) }

@Composable
fun DashboardTela(estado: EstadoApp, modifier: Modifier = Modifier) {
    val ctx = LocalContext.current
    val escopo = rememberCoroutineScope()
    var painel by remember { mutableStateOf(Painel.cache(ctx)) }
    var buscando by remember { mutableStateOf(false) }
    var erro by remember { mutableStateOf<String?>(null) }
    var idade by remember { mutableStateOf(Painel.idadeMs(ctx)) }
    val rolagem = rememberScrollState()

    fun atualizar() {
        if (buscando) return
        buscando = true; erro = null
        val app = ctx.applicationContext
        escopo.launch(Dispatchers.IO) {
            val r = Painel.buscar(app)
            withContext(Dispatchers.Main) {
                buscando = false
                if (r == null) erro = "Não consegui atualizar agora." else painel = r
                idade = Painel.idadeMs(app)
            }
        }
    }
    LaunchedEffect(Unit) { if (painel == null || Painel.idadeMs(ctx) > 120_000) atualizar() }
    LaunchedEffect(estado.rolar) { if (estado.rolar >= 0) { delay(500); rolagem.scrollTo(estado.rolar) } }

    val d = painel
    Column(modifier.fillMaxSize().verticalScroll(rolagem).padding(horizontal = 20.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        // saudação
        val hora = Calendar.getInstance().get(Calendar.HOUR_OF_DAY)
        val saud = (if (hora in 6..11) "Bom dia" else if (hora in 12..17) "Boa tarde" else "Boa noite") + ", " + (d?.optString("nome")?.ifBlank { null } ?: "Bruno") + "!"
        Column {
            Text(saud, style = MaterialTheme.typography.headlineMedium, color = Paleta.Texto)
            if (d != null) {
                val nEv = d.optJSONArray("eventos")?.length() ?: 0; val nTa = d.optJSONArray("tarefas")?.length() ?: 0
                val turno = d.optString("turno")
                val resumo = (if (nEv == 0) "agenda livre" else "$nEv eventos") + " · " + (if (nTa == 0) "sem tarefas" else "$nTa tarefas") +
                    (if (d.isNull("emailsNaoLidos")) "" else " · ${d.optInt("emailsNaoLidos")} e-mails")
                Text((if (turno == "manha") "Turno da manhã · " else if (turno == "tarde") "Turno da tarde · " else "") + resumo,
                    style = MaterialTheme.typography.bodyMedium, color = Paleta.Secundario, modifier = Modifier.padding(top = 4.dp))
            }
            Row(Modifier.padding(top = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                if (buscando) { CircularProgressIndicator(Modifier.width(14.dp).height(14.dp), color = Paleta.Destaque, strokeWidth = 2.dp); Spacer(Modifier.width(8.dp)) }
                Text(
                    if (buscando) "Atualizando…" else erro ?: if (d == null) "Ainda sem dados." else "Atualizado há " + (if (idade < 90_000) "instantes" else "${idade / 60_000} min"),
                    style = MaterialTheme.typography.bodySmall, color = if (erro != null) Paleta.Atencao else Paleta.Secundario
                )
            }
        }

        if (d != null) {
            // Finanças: o número grande primeiro
            val f = d.optJSONObject("financas")
            if (f != null && f.optBoolean("ok")) {
                Cartao("Finanças") {
                    Text("LIVRE HOJE", style = MaterialTheme.typography.labelSmall, color = Paleta.Secundario)
                    Text(brl(f.optDouble("livreHoje")), style = MaterialTheme.typography.displaySmall, color = Paleta.Destaque)
                    Spacer(Modifier.height(6.dp))
                    LinhaInfo("Previsão do fim do mês", brl(f.optDouble("livreFim")))
                    LinhaInfo("A pagar", brl(f.optDouble("aPagar")) + " · ${f.optInt("nPendentes")} contas")
                    if (!f.isNull("investido")) LinhaInfo("Investido", brl(f.optDouble("investido")))
                    if (!f.isNull("reservaMeses")) LinhaInfo("Reserva", String.format(ptBR, "%.1f meses", f.optDouble("reservaMeses")))
                    f.optJSONObject("gastos")?.let { g ->
                        LinhaInfo("Gastos hoje · semana · mês", listOf("hoje", "semana", "mes").joinToString(" · ") { if (g.isNull(it)) "—" else brl(g.optDouble(it)) })
                    }
                    val venc = f.optJSONArray("vencimentos").itens()
                    if (venc.isNotEmpty()) {
                        Subtitulo("Vencimentos")
                        venc.forEach { o ->
                            val quando = if (o.optBoolean("atrasada")) "atrasada" else if (o.optBoolean("hoje")) "hoje" else if (o.isNull("dia")) "" else "dia ${o.optInt("dia")}"
                            LinhaInfo(o.optString("nome") + if (quando.isNotEmpty()) " · $quando" else "", brl(o.optDouble("valor")),
                                if (o.optBoolean("atrasada")) Paleta.Erro else Paleta.Texto)
                        }
                    }
                }
            } else if (f != null) Cartao("Finanças") { Text(f.optString("erro", "indisponível"), style = MaterialTheme.typography.bodyMedium, color = Paleta.Secundario) }

            Cartao("Notificações do celular") {
                val nt = d.optJSONArray("notificacoes").itens().take(8)
                if (nt.isEmpty()) Vazio("Nada por enquanto.")
                val fmt = SimpleDateFormat("dd/MM HH:mm", ptBR)
                nt.forEachIndexed { i, o ->
                    if (i > 0) Divisor()
                    Column(Modifier.padding(vertical = 8.dp)) {
                        Text(o.optString("app") + " · " + fmt.format(Date(o.optLong("em"))), style = MaterialTheme.typography.bodySmall, color = Paleta.Secundario)
                        Text((o.optString("titulo") + " " + o.optString("texto")).trim(), style = MaterialTheme.typography.bodyMedium, color = Paleta.Texto)
                    }
                }
            }

            Cartao("Alertas de voz (Android)") {
                val av = d.optJSONArray("alertasVoz").itens()
                if (av.isEmpty()) Vazio("Nenhum alerta de voz agendado.")
                val nomes = arrayOf("Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb")
                av.forEachIndexed { i, o ->
                    if (i > 0) Divisor()
                    val dias = o.optJSONArray("dias")
                    val quando = String.format("%02d:%02d", o.optInt("hora"), o.optInt("minuto")) + " · " +
                        (if (dias == null || dias.length() == 0) "todos os dias" else (0 until dias.length()).joinToString(",") { nomes[dias.optInt(it).coerceIn(0, 6)] }) +
                        if (o.optBoolean("dinamico")) " · dinâmico" else ""
                    Column(Modifier.padding(vertical = 7.dp)) {
                        Text(quando, style = MaterialTheme.typography.bodySmall, color = Paleta.Secundario)
                        Text(o.optString("texto"), style = MaterialTheme.typography.bodyMedium, color = Paleta.Texto)
                    }
                }
            }

            Cartao("Comunicação") {
                Text("WhatsApp desligado · e-mails não lidos: " + (if (d.isNull("emailsNaoLidos")) "—" else d.optInt("emailsNaoLidos").toString()),
                    style = MaterialTheme.typography.bodySmall, color = Paleta.Secundario, modifier = Modifier.padding(bottom = 4.dp))
                d.optJSONArray("emails").itens().forEachIndexed { i, o ->
                    if (i > 0) Divisor()
                    Column(Modifier.padding(vertical = 6.dp)) {
                        Text(o.optString("de"), style = MaterialTheme.typography.bodySmall, color = Paleta.Secundario)
                        Text(o.optString("assunto"), style = MaterialTheme.typography.bodyMedium, color = Paleta.Texto)
                    }
                }
            }

            Cartao("Próximos eventos") {
                val ev = d.optJSONArray("eventos").itens()
                if (ev.isEmpty()) Vazio("Nenhum compromisso nos próximos 7 dias.")
                ev.forEach { LinhaDupla(it.optString("inicio"), it.optString("titulo")) }
            }

            Cartao("Tarefas") {
                val ta = d.optJSONArray("tarefas").itens()
                if (ta.isEmpty()) Vazio("Sem tarefas pendentes.")
                ta.forEach { LinhaDupla("•", it.optString("titulo")) }
            }

            Cartao("Autorizações pendentes") {
                val au = d.optJSONArray("autorizacoes").itens()
                if (au.isEmpty()) Vazio("Nenhuma autorização aguardando.")
                au.forEachIndexed { i, o ->
                    if (i > 0) Divisor()
                    Column(Modifier.padding(vertical = 6.dp)) {
                        Text(o.optString("de"), style = MaterialTheme.typography.bodySmall, color = Paleta.Secundario)
                        Text(o.optString("pedido"), style = MaterialTheme.typography.bodyMedium, color = Paleta.Texto)
                    }
                }
            }
        }

        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Center) {
            Pilula(if (buscando) "Atualizando…" else "Atualizar agora", onClick = { atualizar() }, destaque = !buscando)
        }
        Spacer(Modifier.height(12.dp))
    }
}

@Composable
fun Vazio(msg: String) {
    Text(msg, style = MaterialTheme.typography.bodyMedium, color = Paleta.Secundario, modifier = Modifier.padding(vertical = 4.dp))
}

@Composable
fun LinhaDupla(a: String, b: String) {
    Row(Modifier.fillMaxWidth().padding(vertical = 5.dp)) {
        Text(a, style = MaterialTheme.typography.bodyMedium, color = Paleta.Secundario, modifier = Modifier.width(92.dp))
        Text(b, style = MaterialTheme.typography.bodyMedium, color = Paleta.Texto, modifier = Modifier.weight(1f))
    }
}
