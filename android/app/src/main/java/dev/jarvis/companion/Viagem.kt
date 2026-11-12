package dev.jarvis.companion

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.location.Location
import android.os.Build
import android.os.IBinder
import android.os.Looper
import androidx.core.content.ContextCompat
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationResult
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.util.concurrent.Executors
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.sqrt

/**
 * Modo viagem no app (0.16.0, substitui a macro Viagem): lê o GPS, calcula a velocidade e descobre o limite da via; o servidor decide o que falar
 * (excesso persistente, fadiga a cada 2 h, chegada) e, enquanto há viagem, cala os avisos que não são urgentes (bateria, insight, diagnóstico).
 *
 * LIMITE DA VIA: a macro lia a placa que o Google Maps desenha na tela (exigia leitura de tela). Aqui vem do OpenStreetMap (Overpass, sem chave):
 * a via mais próxima com `maxspeed`. PRIVACIDADE: a posição vai a um servidor público (overpass-api.de) só para essa consulta, no máximo a cada 15 s e
 * só depois de andar 80 m; dá para desligar na tela (então vale o limite configurado no servidor). Ao Jarvis vão só a velocidade e o limite, nunca a posição.
 */
object Viagem {
    @Volatile var ativa = false
    @Volatile var velocidade = 0
    @Volatile var limite = 0                  // 0 = desconhecido
    @Volatile var fonteLimite = ""            // "via (OpenStreetMap)", "servidor" ou ""
    @Volatile var maxima = 0
    @Volatile var inicio = 0L
    @Volatile var ultimoEnvioOk = 0L
    @Volatile var simulada = -1               // só por ADB (--ef velteste): velocidade simulada, para testar sem dirigir
    @Volatile var limiteSimulado = -1

    fun lerOsm(ctx: Context): Boolean = Config.estado(ctx).getBoolean("viagem_osm", true)
    fun gravarOsm(ctx: Context, v: Boolean) { Config.estado(ctx).edit().putBoolean("viagem_osm", v).apply() }

    fun iniciar(ctx: Context) {
        ContextCompat.startForegroundService(ctx, Intent(ctx, ViagemService::class.java).setAction("iniciar"))
    }
    fun encerrar(ctx: Context) {
        if (!ativa) return
        ctx.startService(Intent(ctx, ViagemService::class.java).setAction("parar"))
    }
}

/** Limite de velocidade da via mais próxima, pelo OpenStreetMap. */
object LimiteVia {
    private var ultimoLat = 0.0
    private var ultimoLon = 0.0
    private var ultimoEm = 0L
    private var cache: Int? = null

    /** Km/h da via mais próxima (20 a 130), ou null. Respeita o intervalo mínimo e a distância mínima entre consultas. */
    @Synchronized
    fun consultar(lat: Double, lon: Double): Int? {
        val agora = System.currentTimeMillis()
        val andou = distancia(lat, lon, ultimoLat, ultimoLon)
        if (ultimoEm != 0L && (agora - ultimoEm < 15_000 || (andou < 80 && cache != null))) return cache
        ultimoEm = agora; ultimoLat = lat; ultimoLon = lon
        cache = try { buscar(lat, lon) } catch (_: Exception) { cache }
        return cache
    }

    private fun buscar(lat: Double, lon: Double): Int? {
        val q = "[out:json][timeout:6];way(around:25,$lat,$lon)[\"highway\"][\"maxspeed\"];out geom 8;"
        val c = URL("https://overpass-api.de/api/interpreter").openConnection() as HttpURLConnection
        c.requestMethod = "POST"; c.doOutput = true; c.connectTimeout = 5000; c.readTimeout = 7000
        c.setRequestProperty("User-Agent", "JarvisCompanion/0.16 (uso pessoal)")
        c.outputStream.use { it.write(("data=" + URLEncoder.encode(q, "UTF-8")).toByteArray()) }
        if (c.responseCode !in 200..299) { c.disconnect(); return null }
        val txt = c.inputStream.bufferedReader().use { it.readText() }; c.disconnect()
        val els = JSONObject(txt).optJSONArray("elements") ?: return null
        var melhor: Int? = null; var menor = Double.MAX_VALUE
        for (i in 0 until els.length()) {
            val e = els.getJSONObject(i)
            val v = Regex("^\\s*(\\d{2,3})\\s*$").find(e.optJSONObject("tags")?.optString("maxspeed") ?: "")?.groupValues?.get(1)?.toIntOrNull() ?: continue
            if (v < 20 || v > 130) continue
            val g = e.optJSONArray("geometry") ?: continue
            var d = Double.MAX_VALUE
            for (k in 0 until g.length() - 1) {
                val a = g.getJSONObject(k); val b = g.getJSONObject(k + 1)
                d = minOf(d, distSegmento(lat, lon, a.getDouble("lat"), a.getDouble("lon"), b.getDouble("lat"), b.getDouble("lon")))
            }
            if (d < menor) { menor = d; melhor = v }
        }
        return melhor
    }

    private fun distancia(la1: Double, lo1: Double, la2: Double, lo2: Double): Double {
        val kx = 111_320.0 * cos(la1 * PI / 180); val ky = 110_540.0
        return sqrt(((lo2 - lo1) * kx).let { it * it } + ((la2 - la1) * ky).let { it * it })
    }

    /** Distância em metros do ponto ao segmento (aproximação plana, boa para dezenas de metros). */
    private fun distSegmento(lat: Double, lon: Double, la1: Double, lo1: Double, la2: Double, lo2: Double): Double {
        val kx = 111_320.0 * cos(lat * PI / 180); val ky = 110_540.0
        val px = 0.0; val py = 0.0
        val ax = (lo1 - lon) * kx; val ay = (la1 - lat) * ky; val bx = (lo2 - lon) * kx; val by = (la2 - lat) * ky
        val dx = bx - ax; val dy = by - ay
        val t = if (dx == 0.0 && dy == 0.0) 0.0 else (((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)).coerceIn(0.0, 1.0)
        val cx = ax + t * dx; val cy = ay + t * dy
        return sqrt((px - cx) * (px - cx) + (py - cy) * (py - cy))
    }
}

class ViagemService : Service() {
    private val exec = Executors.newSingleThreadExecutor()
    private val amostras = ArrayDeque<Int>()
    private var ultimaNotificacao = 0L
    private var ultimoEnvio = 0L
    private var ultimoAviso = 0L
    private var parado = 0L                       // desde quando está parado (para encerrar sozinho)
    private var ultimoLat = Double.NaN
    private var ultimoLon = Double.NaN
    private var limiteServidor = 0
    private val cli by lazy { LocationServices.getFusedLocationProviderClient(this) }
    private val retorno = object : LocationCallback() {
        override fun onLocationResult(r: LocationResult) { r.lastLocation?.let { tratar(it) } }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == "parar") { encerrar("pedido do dono"); return START_NOT_STICKY }
        if (!Viagem.ativa) iniciar()
        return START_NOT_STICKY
    }

    private fun canal() {
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.createNotificationChannel(NotificationChannel("viagem", "Modo viagem", NotificationManager.IMPORTANCE_LOW))
    }

    private fun notificacao(texto: String): Notification {
        val parar = PendingIntent.getService(this, 1, Intent(this, ViagemService::class.java).setAction("parar"), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val abrir = PendingIntent.getActivity(this, 2, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        return Notification.Builder(this, "viagem").setSmallIcon(android.R.drawable.ic_menu_directions)
            .setContentTitle("Viagem em andamento").setContentText(texto).setOngoing(true).setOnlyAlertOnce(true).setContentIntent(abrir)
            .addAction(Notification.Action.Builder(null, "Encerrar", parar).build()).build()
    }

    private fun iniciar() {
        canal()
        val n = notificacao("Lendo o GPS…")
        if (Build.VERSION.SDK_INT >= 29) startForeground(31, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION) else startForeground(31, n)
        Viagem.ativa = true; Viagem.inicio = System.currentTimeMillis(); Viagem.velocidade = 0; Viagem.maxima = 0; Viagem.limite = 0; Viagem.fonteLimite = ""
        Config.evento(this, "viagem: iniciada")
        val req = LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, 3000).setMinUpdateIntervalMillis(1500).build()
        try { cli.requestLocationUpdates(req, retorno, Looper.getMainLooper()) }
        catch (e: SecurityException) { Config.evento(this, "viagem: sem permissão de localização"); encerrar("sem permissão") }
    }

    private fun tratar(l: Location) {
        val agora = System.currentTimeMillis()
        var v = if (Viagem.simulada >= 0) Viagem.simulada else if (l.hasSpeed() && l.speedAccuracyMetersPerSecond.let { it.isNaN() || it < 3f || !l.hasSpeedAccuracy() }) Math.round(l.speed * 3.6f) else 0
        // mediana de 3 leituras: o GPS dá picos isolados que virariam "excesso"
        amostras.addLast(v); while (amostras.size > 3) amostras.removeFirst()
        v = amostras.sorted()[amostras.size / 2]
        Viagem.velocidade = v
        if (v > Viagem.maxima) Viagem.maxima = v
        ultimoLat = l.latitude; ultimoLon = l.longitude

        // encerra sozinho depois de 10 min parado (estacionou)
        if (v < 3) { if (parado == 0L) parado = agora else if (agora - parado > 10 * 60_000L) { encerrar("parado há 10 min"); return } } else parado = 0L

        // limite da via (OpenStreetMap), fora da thread principal
        if (Viagem.limiteSimulado >= 0) { Viagem.limite = Viagem.limiteSimulado; Viagem.fonteLimite = "simulado" }
        else if (Viagem.lerOsm(this)) exec.execute {
            val lim = LimiteVia.consultar(l.latitude, l.longitude)
            if (lim != null) { Viagem.limite = lim; Viagem.fonteLimite = "via (OpenStreetMap)" }
            else if (limiteServidor > 0) { Viagem.limite = limiteServidor; Viagem.fonteLimite = "servidor" }
        } else if (limiteServidor > 0) { Viagem.limite = limiteServidor; Viagem.fonteLimite = "servidor" }

        // aviso rápido do aparelho (o do servidor só entra se o excesso persistir, com cooldown de 3 min)
        if (Viagem.limite > 0 && v > Viagem.limite + 7 && agora - ultimoAviso > 60_000L) {
            ultimoAviso = agora
            falar("Atenção, $v por hora. O limite é ${Viagem.limite}.")
        }
        if (agora - ultimaNotificacao > 3000) {
            ultimaNotificacao = agora
            (getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).notify(31,
                notificacao("$v km/h" + if (Viagem.limite > 0) " · limite ${Viagem.limite}" else ""))
        }
        if (agora - ultimoEnvio > 10_000L) { ultimoEnvio = agora; enviar(v, false) }
    }

    private fun enviar(v: Int, fim: Boolean) {
        exec.execute {
            val corpo = JSONObject().put("action", "android_viagem").put("velocidade", v)
            if (fim) corpo.put("encerrar", true)
            if (Viagem.limite > 0 && Viagem.fonteLimite.startsWith("via")) corpo.put("limiteTela", Viagem.limite)
            val r = Api.post(this, corpo, 20000)
            if (r?.optBoolean("ok") == true) {
                Viagem.ultimoEnvioOk = System.currentTimeMillis()
                if (r.optInt("limite") > 0) { limiteServidor = r.optInt("limite"); if (Viagem.limite == 0) { Viagem.limite = limiteServidor; Viagem.fonteLimite = "servidor" } }
                val f = r.optString("falar")
                if (f.isNotBlank()) falar(f)
            }
        }
    }

    private fun falar(texto: String) {
        // fala local, rápida; o id começa com "v" para não virar "a última fala" (ver FalaService)
        ContextCompat.startForegroundService(this, Intent(this, FalaService::class.java).putExtra("id", "v" + System.currentTimeMillis().toString(36)).putExtra("texto", texto).putExtra("local", true))
    }

    private fun encerrar(motivo: String) {
        if (!Viagem.ativa) { stopSelf(); return }
        Config.evento(this, "viagem: encerrada ($motivo) · ${Math.round((System.currentTimeMillis() - Viagem.inicio) / 60000.0)} min, máxima ${Viagem.maxima} km/h")
        try { cli.removeLocationUpdates(retorno) } catch (_: Exception) {}
        enviar(Viagem.velocidade, true)
        Viagem.ativa = false
        exec.execute { try { Thread.sleep(2500) } catch (_: Exception) {}; stopForeground(STOP_FOREGROUND_REMOVE); stopSelf() }
    }

    override fun onDestroy() { try { cli.removeLocationUpdates(retorno) } catch (_: Exception) {}; Viagem.ativa = false; super.onDestroy() }
}
