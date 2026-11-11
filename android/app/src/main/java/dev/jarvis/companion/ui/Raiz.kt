package dev.jarvis.companion.ui

import android.os.Build
import androidx.compose.animation.Crossfade
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import dev.jarvis.companion.AckQueue
import dev.jarvis.companion.BuildConfigVersao
import dev.jarvis.companion.Config
import kotlinx.coroutines.delay

/** Estado que a Activity e os ganchos de ADB (--ei aba, --ei rolar) compartilham com as telas. */
class EstadoApp {
    var aba by mutableIntStateOf(0)
    var rolar by mutableIntStateOf(-1)
}

@Composable
fun JarvisApp(estado: EstadoApp) {
    val ctx = LocalContext.current
    val tick by produceState(0) { while (true) { delay(2500); value++ } }
    @Suppress("UNUSED_EXPRESSION") tick
    val pareado = Config.pareado(ctx)
    val ok = pareado && AckQueue.pendentes(ctx) == 0

    Scaffold(
        containerColor = Paleta.Fundo,
        contentWindowInsets = WindowInsets(0),
        topBar = {
            Row(Modifier.fillMaxWidth().statusBarsPadding().padding(start = 20.dp, end = 20.dp, top = 12.dp, bottom = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                Orbe(40.dp)
                Column(Modifier.weight(1f).padding(start = 12.dp)) {
                    Text("Jarvis", style = MaterialTheme.typography.titleLarge, color = Paleta.Texto)
                    Text("${Build.MODEL} · v${BuildConfigVersao.NOME.substringBefore("-")}", style = MaterialTheme.typography.bodySmall, color = Paleta.Secundario)
                }
                SeloChip(if (ok) "Conectado" else if (!pareado) "Sem pareamento" else "Atenção", ok)
            }
        },
        bottomBar = {
            NavigationBar(containerColor = Paleta.Fundo, tonalElevation = 0.dp) {
                listOf("Chat", "Dashboard", "Dispositivo").forEachIndexed { i, nome ->
                    NavigationBarItem(
                        selected = estado.aba == i, onClick = { estado.aba = i; estado.rolar = -1 },
                        icon = { IconeAba(i) },
                        label = { Text(nome, style = MaterialTheme.typography.labelMedium) },
                        colors = NavigationBarItemDefaults.colors(
                            indicatorColor = Paleta.DestaqueSuave,
                            selectedIconColor = Paleta.Destaque, selectedTextColor = Paleta.Destaque,
                            unselectedIconColor = Paleta.Secundario, unselectedTextColor = Paleta.Secundario
                        )
                    )
                }
            }
        }
    ) { pad ->
        Box(Modifier.padding(pad).consumeWindowInsets(pad).imePadding().background(Paleta.Fundo)) {
            Crossfade(targetState = estado.aba, animationSpec = tween(160), label = "aba") { aba ->
                when (aba) {
                    0 -> ChatTela()
                    1 -> DashboardTela(estado)
                    else -> DispositivoTela(estado)
                }
            }
        }
    }
}
