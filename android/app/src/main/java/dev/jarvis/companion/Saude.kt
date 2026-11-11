package dev.jarvis.companion

import android.Manifest
import android.app.NotificationManager
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.os.PowerManager
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Saúde do app: o que faltou nos diagnósticos de 09 a 11/11 (a escuta caiu sem ninguém ver, a notificação sumiu sem rastro, a permissão certa
 * não estava concedida). Guarda poucas marcas no estado local (sem segredo) e monta a lista de permissões que o Jarvis usa.
 */
object Saude {
    // ---- marcas ----
    fun escutaLigada(ctx: Context) {
        val p = Config.estado(ctx)
        val hoje = dia()
        val n = if (p.getString("religacoes_dia", "") == hoje) p.getInt("religacoes_n", 0) else 0
        p.edit().putLong("escuta_desde", System.currentTimeMillis()).putString("religacoes_dia", hoje).putInt("religacoes_n", n + 1).apply()
    }
    fun escutaCaiu(ctx: Context) { Config.estado(ctx).edit().putLong("escuta_caiu_em", System.currentTimeMillis()).apply() }
    fun notifEnviada(ctx: Context, app: String) { Config.estado(ctx).edit().putLong("notif_env_em", System.currentTimeMillis()).putString("notif_env_app", app).apply() }
    fun ordemRecebida(ctx: Context, tipo: String) { Config.estado(ctx).edit().putLong("ordem_em", System.currentTimeMillis()).putString("ordem_tipo", tipo).apply() }
    fun telemetriaEnviada(ctx: Context) { Config.estado(ctx).edit().putLong("tel_env_em", System.currentTimeMillis()).apply() }
    fun processoIniciado(ctx: Context) { Config.estado(ctx).edit().putLong("processo_desde", System.currentTimeMillis()).apply() }

    private fun dia() = SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date())

    // ---- leitura ----
    fun duracao(ms: Long): String {
        val min = ms / 60000
        return when {
            min < 1 -> "menos de 1 min"
            min < 60 -> "$min min"
            min < 1440 -> "${min / 60} h ${min % 60} min"
            else -> "${min / 1440} d ${(min % 1440) / 60} h"
        }
    }
    fun ha(ms: Long): String = if (ms <= 0) "nunca" else "há " + duracao(System.currentTimeMillis() - ms)

    class Permissao(val nome: String, val ok: Boolean, val critica: Boolean, val como: String)

    fun permissoes(ctx: Context): List<Permissao> {
        val pkg = ctx.packageName
        fun seg(chave: String): String? = android.provider.Settings.Secure.getString(ctx.contentResolver, chave)
        val escuta = seg("enabled_notification_listeners")?.contains(pkg) == true
        val aviso = Build.VERSION.SDK_INT < 33 || ctx.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
        val loc = ctx.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
        val locFundo = Build.VERSION.SDK_INT < 29 || ctx.checkSelfPermission(Manifest.permission.ACCESS_BACKGROUND_LOCATION) == PackageManager.PERMISSION_GRANTED
        val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val pm = ctx.getSystemService(Context.POWER_SERVICE) as PowerManager
        val assist = seg("assistant")?.contains(pkg) == true
        return listOf(
            Permissao("Acesso às notificações", escuta, true, "Configurações → Notificações → Acesso a notificações"),
            Permissao("Avisos do app", aviso, true, "Permita as notificações do Jarvis"),
            Permissao("Localização o tempo todo", loc && locFundo, true, "Necessária para o nome do Wi-Fi em segundo plano"),
            Permissao("Dados de uso (ponto)", AberturaApps.temAcesso(ctx), true, "Acesso especial: dados de uso"),
            Permissao("Sobrepor outros apps", android.provider.Settings.canDrawOverlays(ctx), false, "Para abrir app, link e rota do fundo"),
            Permissao("Não perturbe", nm.isNotificationPolicyAccessGranted, false, "Para ligar e desligar o Não perturbe"),
            Permissao("Sem economia de bateria", pm.isIgnoringBatteryOptimizations(pkg), false, "Evita que o MIUI derrube o serviço"),
            Permissao("Assistente padrão", assist, false, "Botão de energia abre o Jarvis")
        )
    }
}
