package dev.jarvis.companion

import android.service.quicksettings.Tile
import android.service.quicksettings.TileService

/** Atalho "Ouvir de novo" nas configurações rápidas (puxe a cortina e toque): repete a última fala do Jarvis. */
class RepetirTile : TileService() {
    override fun onStartListening() {
        qsTile?.apply {
            state = if (UltimaFala.existe(this@RepetirTile)) Tile.STATE_INACTIVE else Tile.STATE_UNAVAILABLE
            label = "Ouvir de novo"; updateTile()
        }
    }

    override fun onClick() {
        UltimaFala.repetir(this)
    }
}
