package dev.jarvis.companion.ui

import android.Manifest
import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.text.Html
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.clickable
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
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import dev.jarvis.companion.AckQueue
import dev.jarvis.companion.AberturaApps
import dev.jarvis.companion.Config
import dev.jarvis.companion.Geocerca
import dev.jarvis.companion.FalaService
import dev.jarvis.companion.NotifFila
import dev.jarvis.companion.NotificacaoService
import dev.jarvis.companion.Painel
import dev.jarvis.companion.Saude
import dev.jarvis.companion.UltimaFala
import dev.jarvis.companion.Viagem
import dev.jarvis.companion.WidgetConversa
import kotlinx.coroutines.delay
import java.net.URI
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

private val ptBR = Locale("pt", "BR")

private fun abrirConfig(ctx: Context, acao: String, pacote: Boolean = false) {
    try {
        val i = Intent(acao).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        if (pacote) i.data = Uri.parse("package:" + ctx.packageName)
        ctx.startActivity(i)
    } catch (e: Exception) {
        try { ctx.startActivity(Intent(Settings.ACTION_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) } catch (_: Exception) {}
    }
}

@Composable
fun DispositivoTela(estado: EstadoApp, modifier: Modifier = Modifier) {
    val ctx = LocalContext.current
    val rolagem = rememberScrollState()
    val tick by produceState(0) { while (true) { delay(2500); value++ } }   // reler as marcas guardadas a cada 2,5 s (Saúde ao vivo)
    var eventosMax by remember { mutableIntStateOf(15) }
    val pedirLocalizacao = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { }
    LaunchedEffect(estado.rolar) { if (estado.rolar >= 0) { delay(500); rolagem.scrollTo(estado.rolar) } }
    @Suppress("UNUSED_EXPRESSION") tick

    val est = Config.estado(ctx)
    val painel = Painel.cache(ctx)
    val permissoes = Saude.permissoes(ctx)
    val faltaCritica = permissoes.filter { it.critica && !it.ok }
    val escutaViva = NotificacaoService.ligada
    val desde = est.getLong("escuta_desde", 0L)
    val caiuEm = est.getLong("escuta_caiu_em", 0L)
    val fila = NotifFila.pendentes(ctx)
    val saudeOk = escutaViva && faltaCritica.isEmpty() && fila == 0
    val hoje = SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date())

    Column(modifier.fillMaxSize().verticalScroll(rolagem).padding(horizontal = 20.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Column {
            Text("Dispositivo", style = MaterialTheme.typography.headlineMedium, color = Paleta.Texto)
            Text(if (Config.pareado(ctx) && AckQueue.pendentes(ctx) == 0) "Tudo certo." else "Há algo para olhar abaixo.", style = MaterialTheme.typography.bodyMedium,
                color = Paleta.Secundario, modifier = Modifier.padding(top = 4.dp))
        }

        // ---- Saúde do app
        Cartao("Saúde do app", selo = if (saudeOk) "Tudo certo" else "Atenção", seloBom = saudeOk) {
            LinhaInfo("Escuta de notificações",
                if (escutaViva) "Viva há " + Saude.duracao(System.currentTimeMillis() - desde) else if (caiuEm > 0) "Desligada " + Saude.ha(caiuEm) else "Desligada",
                if (escutaViva) Paleta.Texto else Paleta.Atencao)
            LinhaInfo("Religações hoje", if (est.getString("religacoes_dia", "") == hoje) est.getInt("religacoes_n", 0).toString() else "0")
            val env = est.getLong("notif_env_em", 0L)
            LinhaInfo("Última notificação enviada", if (env > 0) Saude.ha(env) + " · " + (est.getString("notif_env_app", "") ?: "") else "nenhuma ainda")
            LinhaInfo("Fila de envio", fila.toString(), if (fila == 0) Paleta.Texto else Paleta.Atencao)
            val ord = est.getLong("ordem_em", 0L)
            LinhaInfo("Última ordem do Jarvis", if (ord > 0) Saude.ha(ord) + " · " + (est.getString("ordem_tipo", "") ?: "") else "nenhuma ainda")
            LinhaInfo("Última telemetria", Saude.ha(est.getLong("tel_env_em", 0L)))
            LinhaInfo("Processo iniciado", Saude.ha(est.getLong("processo_desde", 0L)))
        }

        // ---- Permissões (toque numa que falta para abrir a tela certa)
        Cartao("Permissões", selo = if (faltaCritica.isEmpty()) "Essenciais ok" else "${faltaCritica.size} faltando", seloBom = faltaCritica.isEmpty()) {
            permissoes.forEachIndexed { i, p ->
                if (i > 0) Divisor()
                val abrir: (() -> Unit)? = if (p.ok) null else when (p.nome) {
                    "Acesso às notificações" -> ({ abrirConfig(ctx, Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS) })
                    "Avisos do app" -> ({ abrirConfig(ctx, Settings.ACTION_APP_NOTIFICATION_SETTINGS.takeIf { Build.VERSION.SDK_INT >= 26 } ?: Settings.ACTION_SETTINGS) })
                    "Localização o tempo todo" -> ({ if (ctx.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != android.content.pm.PackageManager.PERMISSION_GRANTED) pedirLocalizacao.launch(Manifest.permission.ACCESS_FINE_LOCATION) else abrirConfig(ctx, Settings.ACTION_APPLICATION_DETAILS_SETTINGS, true) })
                    "Dados de uso (ponto)" -> ({ abrirConfig(ctx, Settings.ACTION_USAGE_ACCESS_SETTINGS) })
                    "Sobrepor outros apps" -> ({ abrirConfig(ctx, Settings.ACTION_MANAGE_OVERLAY_PERMISSION, true) })
                    "Não perturbe" -> ({ abrirConfig(ctx, Settings.ACTION_NOTIFICATION_POLICY_ACCESS_SETTINGS) })
                    "Sem economia de bateria" -> ({ abrirConfig(ctx, Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS) })
                    "Assistente padrão" -> ({ abrirConfig(ctx, Settings.ACTION_VOICE_INPUT_SETTINGS) })
                    else -> null
                }
                Row(Modifier.fillMaxWidth().let { if (abrir != null) it.clickable { abrir() } else it }.padding(vertical = 9.dp), verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text(p.nome, style = MaterialTheme.typography.bodyMedium, color = Paleta.Texto)
                        if (!p.ok) Text(p.como + (if (abrir != null) " · toque para abrir" else ""), style = MaterialTheme.typography.bodySmall, color = Paleta.Secundario)
                    }
                    Text(if (p.ok) "✓ ok" else if (p.critica) "✗ falta" else "opcional", style = MaterialTheme.typography.labelLarge,
                        color = if (p.ok) Paleta.Ok else if (p.critica) Paleta.Atencao else Paleta.Secundario)
                }
            }
        }

        // ---- Widget
        val awm = AppWidgetManager.getInstance(ctx)
        val temWidget = awm.getAppWidgetIds(ComponentName(ctx, WidgetConversa::class.java)).isNotEmpty()
        Cartao("Atalhos de conversa", selo = if (temWidget) "Widget na tela" else "Sem widget", seloBom = temWidget) {
            Text("Botão de energia (assistente padrão), widget e o ícone do Jarvis abrem a escuta. Diga \"repete\" para ouvir a última fala de novo.", style = MaterialTheme.typography.bodyMedium, color = Paleta.Secundario)
            if (UltimaFala.existe(ctx)) {
                Spacer(Modifier.height(10.dp))
                val em = UltimaFala.em(ctx)
                Pilula("🔊 Ouvir a última fala" + if (em > 0) " (" + Saude.ha(em) + ")" else "", onClick = { UltimaFala.repetir(ctx) })
            }
            if (!temWidget && awm.isRequestPinAppWidgetSupported) {
                Spacer(Modifier.height(10.dp))
                Pilula("Adicionar o widget à tela inicial", onClick = { awm.requestPinAppWidget(ComponentName(ctx, WidgetConversa::class.java), null, null) })
            }
        }

        // ---- do servidor (Dashboard): custos, saúde do sistema, monitores, telemetria
        painel?.optJSONObject("custos")?.takeIf { it.has("gastoBRL") }?.let { cu ->
            val ok = cu.optString("status") == "ok"
            Cartao("Custos de IA · " + cu.optString("mes"), selo = if (ok) "Dentro do teto" else "Atenção", seloBom = ok) {
                LinhaInfo("Gasto no mês (estimado)", brl(cu.optDouble("gastoBRL")))
                LinhaInfo("Teto", brl(cu.optDouble("tetoBRL")))
                LinhaInfo("Uso do teto", String.format(ptBR, "%.0f%%", cu.optDouble("pct")))
                LinhaInfo("Projeção do mês", brl(cu.optDouble("projecaoBRL")))
            }
        }
        painel?.optJSONObject("saude")?.takeIf { it.has("nivel") }?.let { sa ->
            val ok = sa.optString("nivel") == "ok"
            Cartao("Saúde do sistema", selo = if (ok) "Tudo certo" else sa.optString("nivel"), seloBom = ok) {
                if (!sa.isNull("orcamentoPct")) Text("Gatilhos usam " + String.format(ptBR, "%.0f%%", sa.optDouble("orcamentoPct")) + " do orçamento diário", style = MaterialTheme.typography.bodyMedium, color = Paleta.Texto2)
                val al = sa.optJSONArray("alertas")
                if (al != null) for (i in 0 until al.length()) {
                    val x = al.get(i)
                    Text("• " + (if (x is org.json.JSONObject) x.optString("texto", x.toString()) else x.toString()), style = MaterialTheme.typography.bodyMedium, color = Paleta.Texto2, modifier = Modifier.padding(top = 4.dp))
                }
            }
        }
        if (painel != null) Cartao("Monitores web") {
            val mo = painel.optJSONArray("monitores").itens()
            if (mo.isEmpty()) Vazio("Nenhuma página monitorada.")
            mo.forEachIndexed { i, o ->
                if (i > 0) Divisor()
                Column(Modifier.padding(vertical = 6.dp)) {
                    Text(Html.fromHtml(o.optString("descricao").ifBlank { "(sem descrição)" }, Html.FROM_HTML_MODE_LEGACY).toString(), style = MaterialTheme.typography.bodyMedium, color = Paleta.Texto)
                    Text(o.optString("url"), style = MaterialTheme.typography.bodySmall, color = Paleta.Secundario)
                }
            }
        }
        painel?.optJSONObject("telemetria")?.let { t ->
            val rec = t.optString("recebidoEm")
            Cartao("Celular (último aviso ao Jarvis)", selo = if (t.optBoolean("carregando")) "Carregando" else "Na bateria") {
                LinhaInfo("Bateria", t.opt("bateria")?.toString()?.let { "$it%" } ?: "—")
                LinhaInfo("Wi-Fi", t.optString("wifi").ifBlank { "—" })
                LinhaInfo("Recebido", if (rec.length >= 16) rec.substring(8, 10) + "/" + rec.substring(5, 7) + " " + rec.substring(11, 16) + " UTC" else "—")
            }
        }

        CercaGeografica()
        CartaoViagem(tick)

        VozDoCelular()

        // ---- Conexão e notificações
        val host = try { URI(Config.url(ctx) ?: "").host ?: "?" } catch (e: Exception) { "?" }
        val pareado = Config.pareado(ctx)
        Cartao("Conexão", selo = if (pareado) "Pareado" else "Sem pareamento", seloBom = pareado) {
            LinhaInfo("Servidor", if (pareado) host else "—")
            LinhaInfo("Confirmações na fila", AckQueue.pendentes(ctx).toString())
            LinhaInfo("Versão", dev.jarvis.companion.BuildConfigVersao.NOME.substringBefore("-"))
            LinhaInfo("Apps vigiados", NotificacaoService.apps(ctx).size.toString())
        }

        // ---- Últimos eventos
        val eventos = Config.eventosTodos(ctx, eventosMax)
        Cartao("Últimos eventos") {
            if (eventos.isEmpty()) Vazio("Nada por enquanto.")
            eventos.forEachIndexed { i, linha ->
                if (i > 0) Divisor()
                val horaTxt = linha.substringBefore("  ", "").substringAfter(" ", "").take(5)
                val msg = linha.substringAfter("  ", linha)
                Row(Modifier.padding(vertical = 8.dp)) {
                    Text(horaTxt, style = MaterialTheme.typography.bodySmall, color = Paleta.Secundario, modifier = Modifier.width(48.dp))
                    Text(msg, style = MaterialTheme.typography.bodyMedium, color = Paleta.Texto, modifier = Modifier.weight(1f))
                }
            }
            if (Config.eventosTodos(ctx, 400).size > 15) {
                Spacer(Modifier.height(8.dp))
                Pilula(if (eventosMax > 15) "Mostrar só os últimos 15" else "Mostrar mais (até 120)", onClick = { eventosMax = if (eventosMax > 15) 15 else 120 })
            }
        }
        Spacer(Modifier.height(12.dp))
    }
}

/** Voz do celular: gênero, tom e ritmo gravam na hora e valem na próxima fala. */
@Composable
private fun VozDoCelular() {
    val ctx = LocalContext.current
    val e = Config.estado(ctx)
    var genero by remember { mutableStateOf(e.getString("genero", "m") ?: "m") }
    var tom by remember { mutableFloatStateOf(e.getFloat("pitch", FalaService.pitchPadrao(genero))) }
    var ritmo by remember { mutableFloatStateOf(e.getFloat("ritmo", FalaService.ritmoPadrao(genero))) }
    val voz = (e.getString("voz_usada", "") ?: "").ifBlank { "ainda não usada" }

    fun amostra() {
        ContextCompat.startForegroundService(ctx, Intent(ctx, FalaService::class.java)
            .putExtra("id", "t" + System.currentTimeMillis().toString(36))
            .putExtra("texto", "Boa noite. Esta é a voz do Jarvis neste celular.").putExtra("local", true))
    }

    Cartao("Voz do celular") {
        Text("Vale para respostas curtas (hora, saldo) e avisos. Respostas longas saem pela voz premium do Jarvis.", style = MaterialTheme.typography.bodySmall, color = Paleta.Secundario)
        Spacer(Modifier.height(10.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            listOf("m" to "Masculina", "f" to "Feminina").forEach { (g, nome) ->
                Pilula(nome, destaque = g == genero, modifier = Modifier.weight(1f), onClick = {
                    genero = g
                    Config.estado(ctx).edit().putString("genero", g).remove("voz_preferida").remove("pitch").remove("ritmo").apply()
                    tom = FalaService.pitchPadrao(g); ritmo = FalaService.ritmoPadrao(g)
                    Config.evento(ctx, "voz do celular: " + if (g == "f") "feminina" else "masculina")
                    amostra()
                })
            }
        }
        Controle("Tom", tom) { tom = it; Config.estado(ctx).edit().putFloat("pitch", it).apply() }
        Controle("Ritmo", ritmo) { ritmo = it; Config.estado(ctx).edit().putFloat("ritmo", it).apply() }
        LinhaInfo("Voz", voz)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Pilula("Ouvir uma amostra", onClick = { amostra() }, destaque = true)
            Pilula("Voltar ao padrão", onClick = {
                Config.estado(ctx).edit().remove("pitch").remove("ritmo").apply()
                tom = FalaService.pitchPadrao(genero); ritmo = FalaService.ritmoPadrao(genero)
            })
        }
    }
}

@Composable
private fun Controle(nome: String, valor: Float, aoMudar: (Float) -> Unit) {
    Column(Modifier.padding(top = 6.dp)) {
        Row {
            Text(nome, style = MaterialTheme.typography.bodyMedium, color = Paleta.Secundario, modifier = Modifier.weight(1f))
            Text(String.format(ptBR, "%.2f", valor), style = MaterialTheme.typography.bodyMedium, color = Paleta.Texto)
        }
        Slider(
            value = valor.coerceIn(0.5f, 1.5f), onValueChange = { aoMudar((Math.round(it * 100f) / 100f)) }, valueRange = 0.5f..1.5f,
            colors = SliderDefaults.colors(thumbColor = Paleta.Destaque, activeTrackColor = Paleta.Destaque, inactiveTrackColor = Paleta.Borda)
        )
    }
}

/** Modo viagem: GPS, velocidade e limite da via. O servidor avisa excesso, cansaço e chegada; enquanto dura, cala os avisos não urgentes. */
@Composable
private fun CartaoViagem(tick: Int) {
    val ctx = LocalContext.current
    @Suppress("UNUSED_EXPRESSION") tick
    var osm by remember { mutableStateOf(Viagem.lerOsm(ctx)) }
    val ativa = Viagem.ativa
    val permitido = ContextCompat.checkSelfPermission(ctx, Manifest.permission.ACCESS_FINE_LOCATION) == android.content.pm.PackageManager.PERMISSION_GRANTED
    Cartao("Viagem", selo = if (ativa) "Em viagem" else "Parada", seloBom = ativa) {
        Text("Lê o GPS, mede a velocidade e avisa se passar do limite da via. Substitui a macro Viagem.", style = MaterialTheme.typography.bodySmall, color = Paleta.Secundario)
        Spacer(Modifier.height(8.dp))
        if (ativa) {
            LinhaInfo("Velocidade", "${Viagem.velocidade} km/h · máxima ${Viagem.maxima}")
            LinhaInfo("Limite da via", if (Viagem.limite > 0) "${Viagem.limite} km/h (${Viagem.fonteLimite})" else "ainda sem leitura")
            LinhaInfo("Em andamento", "${(System.currentTimeMillis() - Viagem.inicio) / 60000} min")
            LinhaInfo("Servidor", if (Viagem.ultimoEnvioOk > 0) "ouvido " + Saude.ha(Viagem.ultimoEnvioOk) else "sem resposta ainda")
        } else LinhaInfo("Localização", if (permitido) "permitida" else "falta permissão (Permissões, acima)")
        Spacer(Modifier.height(8.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Pilula(if (osm) "Limite pelo mapa: ligado" else "Limite pelo mapa: desligado", destaque = osm, modifier = Modifier.weight(1f), onClick = { osm = !osm; Viagem.gravarOsm(ctx, osm) })
        }
        Text("O limite vem do OpenStreetMap: a posição vai a um servidor público só para essa consulta. Desligado, vale o limite configurado no Jarvis.",
            style = MaterialTheme.typography.bodySmall, color = Paleta.Secundario, modifier = Modifier.padding(top = 6.dp))
        Spacer(Modifier.height(10.dp))
        Pilula(if (ativa) "Encerrar viagem" else "Iniciar viagem", destaque = !ativa, onClick = { if (ativa) Viagem.encerrar(ctx) else if (permitido) Viagem.iniciar(ctx) })
    }
}

/** Cerca geográfica da casa: chegada e saída na hora, sem esperar o ping de telemetria. O ponto fica só neste aparelho. */
@Composable
private fun CercaGeografica() {
    val ctx = LocalContext.current
    var raio by remember { mutableIntStateOf(Geocerca.raio(ctx)) }
    var mensagem by remember { mutableStateOf<String?>(null) }
    var trabalhando by remember { mutableStateOf(false) }
    val definida = Geocerca.definida(ctx)
    val dentro = Geocerca.dentro(ctx)
    val (ultimo, ultimoEm) = Geocerca.ultimoEvento(ctx)
    Cartao("Cerca geográfica", selo = if (definida) "Casa definida" else "Sem casa", seloBom = definida) {
        Text("O Jarvis sabe na hora que você chegou ou saiu de casa, sem esperar o aviso de 15 min. O ponto fica só neste celular.",
            style = MaterialTheme.typography.bodySmall, color = Paleta.Secundario)
        Spacer(Modifier.height(8.dp))
        LinhaInfo("Casa", if (definida) "Definida · raio de ${raio} m" else "Fique em casa e toque em Definir")
        if (definida) {
            LinhaInfo("Agora", when (dentro) { true -> "Dentro da cerca"; false -> "Fora da cerca"; null -> "ainda sem leitura" })
            LinhaInfo("Última transição", if (ultimoEm > 0) when (ultimo) { "entrou" -> "entrou"; "permaneceu" -> "chegou (2 min dentro)"; "saiu" -> "saiu"; else -> ultimo } + " · " + Saude.ha(ultimoEm) else "nenhuma ainda")
        }
        Spacer(Modifier.height(8.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            listOf(100, 150, 250).forEach { r ->
                Pilula("$r m", destaque = r == raio, modifier = Modifier.weight(1f), onClick = {
                    raio = r
                    if (definida) { Config.estado(ctx).edit().putInt("geo_casa_raio", r).apply(); Geocerca.registrar(ctx) }
                })
            }
        }
        Spacer(Modifier.height(10.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Pilula(if (trabalhando) "Lendo a posição…" else if (definida) "Redefinir aqui" else "Definir casa aqui", destaque = true, onClick = {
                if (!trabalhando) {
                    trabalhando = true; mensagem = null
                    Geocerca.definirAqui(ctx, raio) { _, msg -> trabalhando = false; mensagem = msg }
                }
            })
            if (definida) Pilula("Remover", onClick = { Geocerca.remover(ctx); mensagem = "Casa removida." })
        }
        mensagem?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = Paleta.Texto2, modifier = Modifier.padding(top = 10.dp)) }
    }
}
