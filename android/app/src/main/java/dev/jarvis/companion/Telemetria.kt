package dev.jarvis.companion

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.media.AudioManager
import android.net.wifi.WifiManager
import android.os.BatteryManager
import org.json.JSONObject

/**
 * Telemetria do aparelho (substitui a macro Jarvis Telemetria): bateria, tomada, Wi-Fi e volume do toque.
 * O servidor pede por FCM (ordem `telemetria`, a cada 15 min) e o app responde em android_telemetria, com os MESMOS campos da macro,
 * porque o Jarvis usa isso para avisar bateria baixa e saber se o dono chegou em casa (pelo nome do Wi-Fi).
 * "carregando" vai como a macro mandava ("Ligar" = na tomada, "Desligar" = fora), que é o que o servidor entende.
 */
object Telemetria {
    fun coletar(ctx: Context): JSONObject {
        val bat = ctx.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
        val nivel = bat?.let { val l = it.getIntExtra(BatteryManager.EXTRA_LEVEL, -1); val e = it.getIntExtra(BatteryManager.EXTRA_SCALE, 100); if (l < 0 || e <= 0) null else l * 100 / e }
        val ligado = (bat?.getIntExtra(BatteryManager.EXTRA_PLUGGED, 0) ?: 0) != 0
        val am = ctx.getSystemService(Context.AUDIO_SERVICE) as AudioManager
        val volToque = am.getStreamVolume(AudioManager.STREAM_RING) * 100 / maxOf(1, am.getStreamMaxVolume(AudioManager.STREAM_RING))
        return JSONObject()
            .put("action", "android_telemetria")
            .put("bateria_nivel", nivel?.toString() ?: "")
            .put("carregando", if (ligado) "Ligar" else "Desligar")
            .put("wifi_nome", ssid(ctx))
            .put("volume_toque", volToque.toString())
    }

    /**
     * Nome do Wi-Fi. Precisa da permissão de localização (e, em segundo plano, de "o tempo todo"); sem ela o Android devolve "<unknown ssid>".
     * RESERVA (10/11): toda leitura boa é guardada com a hora. Quando o nome não vem MAS o aparelho está num Wi-Fi, usa-se o último
     * nome guardado se tiver menos de 6 h. Fora de Wi-Fi o nome é vazio de verdade: o Jarvis usa isso para saber que você saiu de casa,
     * então nunca se devolve nome guardado sem um Wi-Fi ativo.
     */
    private fun ssid(ctx: Context): String {
        val lido = try {
            if (ctx.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) ""
            else {
                @Suppress("DEPRECATION")
                val s = (ctx.applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager).connectionInfo?.ssid ?: ""
                s.trim('"').let { if (it == "<unknown ssid>" || it == "0x") "" else it }
            }
        } catch (e: Exception) { "" }
        val p = Config.estado(ctx)
        if (lido.isNotBlank()) { p.edit().putString("ultimo_wifi", lido).putLong("ultimo_wifi_em", System.currentTimeMillis()).apply(); return lido }
        if (!emWifi(ctx)) return ""
        val guardado = p.getString("ultimo_wifi", "") ?: ""
        val idade = System.currentTimeMillis() - p.getLong("ultimo_wifi_em", 0L)
        return if (guardado.isNotBlank() && idade < 6 * 60 * 60 * 1000L) guardado else ""
    }

    private fun emWifi(ctx: Context): Boolean = try {
        val cm = ctx.getSystemService(Context.CONNECTIVITY_SERVICE) as android.net.ConnectivityManager
        cm.getNetworkCapabilities(cm.activeNetwork)?.hasTransport(android.net.NetworkCapabilities.TRANSPORT_WIFI) == true
    } catch (e: Exception) { false }

    /** Chamada ao abrir o app (primeiro plano, onde o nome sempre vem): guarda o Wi-Fi de agora para a reserva acima. */
    fun lembrarWifi(ctx: Context) { try { ssid(ctx) } catch (_: Exception) {} }

    /** Coleta e envia agora. → (ok, detalhe) para a confirmação da ordem. */
    fun enviar(ctx: Context): Pair<Boolean, String> {
        val c = coletar(ctx)
        val r = Api.post(ctx, c) ?: return false to "sem rede"
        val resumo = "bateria ${c.optString("bateria_nivel")}% · ${c.optString("carregando")} · wifi ${c.optString("wifi_nome").ifBlank { "—" }}"
        return if (r.optBoolean("ok")) true to resumo else false to ("servidor recusou: " + r.optString("erro").take(60))
    }
}
