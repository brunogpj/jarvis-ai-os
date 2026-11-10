package dev.jarvis.companion

import android.app.AppOpsManager
import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.content.Context
import android.os.Process
import org.json.JSONObject

/**
 * Detecta a ABERTURA do Sisponto (substitui o gatilho "Aplicativo iniciado" da macro Jarvis Ponto do MacroDroid).
 *
 * POR QUE: o Sisponto não emite notificação ao registrar o ponto (confirma por tela), então abrir o app é a única evidência de que
 * o dono bateu o ponto. É ela que arma a cobrança de ausência e cala o lembrete. Um NotificationListener nunca vê isso.
 *
 * COMO: a cada ~10 s, enquanto o serviço de notificações está vivo, lê os eventos de uso (UsageStatsManager) desde a última leitura.
 * Um RESUMED do Sisponto com o app antes fora da frente vale uma abertura; trocar de tela dentro do app não repete (e o mesmo
 * dono não gera outro evento em 2 min). Manda o MESMO evento que a macro mandava, pelo canal de notificações do app (fila com
 * reenvio): app "Sisponto", título "Ponto registrado", texto "Abertura do app Sisponto". Respeita o servidor: só envia com o canal
 * de notificações ligado e o Sisponto na lista de apps vigiados.
 *
 * Exige a permissão especial "Acesso a dados de uso" (adb: appops set dev.jarvis.companion GET_USAGE_STATS allow).
 */
object AberturaApps {
    const val SISPONTO = "br.com.sisponto.sispontomobile"
    private const val INTERVALO_MIN_MS = 2 * 60 * 1000L

    fun temAcesso(ctx: Context): Boolean = try {
        val ops = ctx.getSystemService(Context.APP_OPS_SERVICE) as AppOpsManager
        ops.checkOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), ctx.packageName) == AppOpsManager.MODE_ALLOWED
    } catch (e: Exception) { false }

    @Synchronized
    fun verificar(ctx: Context) {
        if (!temAcesso(ctx)) return
        // sem canal ligado ou sem o Sisponto na lista, nada sai do celular (mesma regra das notificações)
        if (!NotificacaoService.ativo(ctx) || !NotificacaoService.naLista(NotificacaoService.apps(ctx), "sisponto", SISPONTO)) return
        val p = Config.estado(ctx)
        val agora = System.currentTimeMillis()
        // primeira leitura (ou serviço parado há muito): olha só os últimos 15 s, para não reenviar abertura antiga
        val desde = maxOf(p.getLong("ponto_uso_ate", 0L), agora - 60_000L).let { if (p.getLong("ponto_uso_ate", 0L) == 0L) agora - 15_000L else it }
        var emFrente = p.getBoolean("ponto_em_frente", false)
        var ultimo = p.getLong("ponto_ultimo_envio", 0L)
        val usm = ctx.getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager
        val ev = usm.queryEvents(desde, agora)
        val e = UsageEvents.Event()
        val aberturas = ArrayList<Long>()
        while (ev.hasNextEvent()) {
            ev.getNextEvent(e)
            if (e.packageName != SISPONTO) continue
            when (e.eventType) {
                UsageEvents.Event.ACTIVITY_RESUMED -> if (!emFrente) {
                    emFrente = true
                    if (e.timeStamp - ultimo >= INTERVALO_MIN_MS) { aberturas.add(e.timeStamp); ultimo = e.timeStamp }
                }
                UsageEvents.Event.ACTIVITY_PAUSED -> emFrente = false
            }
        }
        p.edit().putLong("ponto_uso_ate", agora).putBoolean("ponto_em_frente", emFrente).putLong("ponto_ultimo_envio", ultimo).apply()
        for (t in aberturas) {
            Config.evento(ctx, "ponto: abertura do Sisponto detectada")
            NotifFila.enviar(ctx, JSONObject().put("app", "Sisponto").put("pacote", SISPONTO).put("titulo", "Ponto registrado").put("texto", "Abertura do app Sisponto"))
        }
    }
}
