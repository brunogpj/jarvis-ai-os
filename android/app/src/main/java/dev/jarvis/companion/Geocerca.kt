package dev.jarvis.companion

import android.Manifest
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import com.google.android.gms.location.Geofence
import com.google.android.gms.location.GeofencingEvent
import com.google.android.gms.location.GeofencingRequest
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import org.json.JSONObject

/**
 * Cerca geográfica da casa (0.14.0): o Jarvis passa a saber que você chegou ou saiu NA HORA, em vez de esperar o próximo ping de telemetria (até 15 min)
 * e depender do nome do Wi-Fi. O ponto é definido pelo próprio app ("Definir casa aqui", com você em casa) e fica só neste aparelho: nenhuma
 * coordenada vai para o repositório nem para o servidor. O servidor só recebe o evento (`entrou`, `permaneceu`, `saiu`) e o Wi-Fi atual.
 *
 * Três transições: ENTER (entrou), DWELL (ficou 2 min dentro: confirma que não era só passagem pela rua) e EXIT (saiu). O servidor decide
 * (android_presenca): `entrou` com o Wi-Fi de casa vale na hora; sem o Wi-Fi espera o `permaneceu`; `saiu` com o Wi-Fi de casa ainda ligado é ruído de GPS.
 *
 * O Android apaga as cercas ao reiniciar e ao atualizar o app: BootReceiver e o início do app registram de novo.
 */
object Geocerca {
    const val RAIO_PADRAO = 150
    private const val ID = "casa"

    fun definida(ctx: Context) = Config.estado(ctx).contains("geo_casa_lat_b")
    fun raio(ctx: Context) = Config.estado(ctx).getInt("geo_casa_raio", RAIO_PADRAO)
    fun dentro(ctx: Context): Boolean? = Config.estado(ctx).let { if (it.contains("geo_dentro")) it.getBoolean("geo_dentro", false) else null }
    fun ultimoEvento(ctx: Context): Pair<String, Long> = Config.estado(ctx).let { (it.getString("geo_ultimo", "") ?: "") to it.getLong("geo_ultimo_em", 0L) }

    private fun temPermissao(ctx: Context) =
        ctx.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED &&
            ctx.checkSelfPermission(Manifest.permission.ACCESS_BACKGROUND_LOCATION) == PackageManager.PERMISSION_GRANTED

    private fun intencao(ctx: Context): PendingIntent =
        PendingIntent.getBroadcast(ctx, 0, Intent(ctx, GeocercaReceiver::class.java), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE)

    /** (Re)registra a cerca no Google Play Services. Seguro chamar sempre: sem ponto definido ou sem permissão, não faz nada. */
    fun registrar(ctx: Context) {
        if (!definida(ctx)) return
        if (!temPermissao(ctx)) { Config.evento(ctx, "cerca: sem a permissão de localização o tempo todo"); return }
        val e = Config.estado(ctx)
        val g = Geofence.Builder().setRequestId(ID)
            .setCircularRegion(java.lang.Double.longBitsToDouble(e.getLong("geo_casa_lat_b", 0L)), java.lang.Double.longBitsToDouble(e.getLong("geo_casa_lng_b", 0L)), raio(ctx).toFloat())
            .setExpirationDuration(Geofence.NEVER_EXPIRE)
            .setTransitionTypes(Geofence.GEOFENCE_TRANSITION_ENTER or Geofence.GEOFENCE_TRANSITION_DWELL or Geofence.GEOFENCE_TRANSITION_EXIT)
            .setLoiteringDelay(120_000)
            .build()
        val req = GeofencingRequest.Builder().setInitialTrigger(GeofencingRequest.INITIAL_TRIGGER_ENTER or GeofencingRequest.INITIAL_TRIGGER_DWELL).addGeofence(g).build()
        val cli = LocationServices.getGeofencingClient(ctx)
        cli.removeGeofences(intencao(ctx)).addOnCompleteListener {
            try {
                cli.addGeofences(req, intencao(ctx))
                    .addOnSuccessListener { Config.evento(ctx, "cerca: casa registrada (raio ${raio(ctx)} m)") }
                    .addOnFailureListener { Config.evento(ctx, "cerca: NÃO registrou (${it.message})") }
            } catch (ex: SecurityException) { Config.evento(ctx, "cerca: sem permissão para registrar") }
        }
    }

    fun remover(ctx: Context) {
        try { LocationServices.getGeofencingClient(ctx).removeGeofences(intencao(ctx)) } catch (_: Exception) {}
        Config.estado(ctx).edit().remove("geo_casa_lat_b").remove("geo_casa_lng_b").remove("geo_dentro").remove("geo_pendente").apply()
        Config.evento(ctx, "cerca: casa removida")
    }

    /** Define a casa na posição de agora. `aoTerminar(ok, mensagem)` roda na thread principal. */
    fun definirAqui(ctx: Context, raio: Int, aoTerminar: (Boolean, String) -> Unit) {
        if (!temPermissao(ctx)) { aoTerminar(false, "Falta a localização \"o tempo todo\" (Permissões)."); return }
        try {
            LocationServices.getFusedLocationProviderClient(ctx).getCurrentLocation(Priority.PRIORITY_HIGH_ACCURACY, null)
                .addOnSuccessListener { l ->
                    if (l == null) { aoTerminar(false, "Não consegui a posição agora. Ligue o GPS e tente de novo."); return@addOnSuccessListener }
                    if (l.accuracy > 80f) { aoTerminar(false, "Precisão ruim (${l.accuracy.toInt()} m). Vá para perto de uma janela e tente de novo."); return@addOnSuccessListener }
                    Config.estado(ctx).edit()
                        .putLong("geo_casa_lat_b", java.lang.Double.doubleToLongBits(l.latitude)).putLong("geo_casa_lng_b", java.lang.Double.doubleToLongBits(l.longitude))
                        .putInt("geo_casa_raio", raio).remove("geo_dentro").apply()
                    Config.evento(ctx, "cerca: casa definida (precisão ${l.accuracy.toInt()} m, raio $raio m)")
                    registrar(ctx)
                    aoTerminar(true, "Casa definida (precisão de ${l.accuracy.toInt()} m).")
                }
                .addOnFailureListener { aoTerminar(false, "Falha ao ler a posição: ${it.message}") }
        } catch (ex: SecurityException) { aoTerminar(false, "Sem permissão de localização.") }
    }

    /** Manda o evento ao servidor (3 tentativas). Se não der, guarda UM pendente e tenta de novo no próximo evento ou ao abrir o app. */
    fun enviar(ctx: Context, evento: String) {
        val t = Telemetria.coletar(ctx)
        val corpo = JSONObject().put("action", "android_presenca").put("evento", evento).put("lugar", "casa")
            .put("wifi_nome", t.optString("wifi_nome")).put("bateria_nivel", t.optString("bateria_nivel"))
            .put("carregando", t.optString("carregando")).put("volume_toque", t.optString("volume_toque"))
        Config.estado(ctx).edit().putString("geo_ultimo", evento).putLong("geo_ultimo_em", System.currentTimeMillis())
            .putBoolean("geo_dentro", evento != "saiu").apply()
        var feito = false
        for (espera in longArrayOf(0, 2000, 6000)) {
            if (espera > 0) Thread.sleep(espera)
            val r = Api.post(ctx, JSONObject(corpo.toString()))
            if (r?.optBoolean("ok") == true) { feito = true; Config.evento(ctx, "cerca: $evento enviado · " + r.optString("acao") + " " + r.optString("motivo").take(50)); break }
        }
        if (!feito) {
            Config.estado(ctx).edit().putString("geo_pendente", corpo.toString()).apply()
            Config.evento(ctx, "cerca: $evento NÃO chegou ao servidor (fica pendente)")
        } else Config.estado(ctx).edit().remove("geo_pendente").apply()
    }

    fun reenviarPendente(ctx: Context) {
        val p = Config.estado(ctx).getString("geo_pendente", null) ?: return
        Thread {
            val r = Api.post(ctx, JSONObject(p))
            if (r?.optBoolean("ok") == true) { Config.estado(ctx).edit().remove("geo_pendente").apply(); Config.evento(ctx, "cerca: evento pendente entregue") }
        }.start()
    }
}

class GeocercaReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, i: Intent) {
        val ev = GeofencingEvent.fromIntent(i) ?: return
        if (ev.hasError()) { Config.evento(ctx, "cerca: erro ${ev.errorCode}"); return }
        val nome = when (ev.geofenceTransition) {
            Geofence.GEOFENCE_TRANSITION_ENTER -> "entrou"
            Geofence.GEOFENCE_TRANSITION_DWELL -> "permaneceu"
            Geofence.GEOFENCE_TRANSITION_EXIT -> "saiu"
            else -> return
        }
        val app = ctx.applicationContext
        val pr = goAsync()
        Thread { try { Geocerca.enviar(app, nome) } finally { pr.finish() } }.start()
    }
}

/** Reinício do aparelho e atualização do app apagam as cercas: registra de novo. */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, i: Intent) { Geocerca.registrar(ctx.applicationContext) }
}
