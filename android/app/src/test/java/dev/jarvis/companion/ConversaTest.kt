package dev.jarvis.companion

import org.junit.Assert.assertEquals
import org.junit.Test

/** Divisão de frase com várias perguntas (sem aparelho, sem rede). */
class ConversaTest {
    @Test fun frase_de_uma_pergunta_nao_divide() {
        assertEquals(listOf("quanto tenho livre"), Conversa.dividir("quanto tenho livre"))
        assertEquals(listOf("me diga o que vence hoje"), Conversa.dividir("me diga o que vence hoje"))
    }

    @Test fun a_frase_longa_do_teste_real_vira_quatro() {
        val f = "me diga que horas são Que dia é hoje quanto eu tenho livre na conta e o que vence hoje ou essa semana"
        assertEquals(listOf("que horas são", "Que dia é hoje", "quanto eu tenho livre na conta", "o que vence hoje ou essa semana"), Conversa.dividir(f))
    }

    @Test fun conectivos_no_fim_de_cada_parte_saem() {
        assertEquals(listOf("quanto tenho livre", "o que vence hoje"), Conversa.dividir("quanto tenho livre e o que vence hoje"))
        assertEquals(listOf("que horas são", "que dia é hoje"), Conversa.dividir("que horas são, que dia é hoje"))
    }

    @Test fun no_maximo_cinco_perguntas() {
        val f = "que horas são que dia é hoje quanto tenho livre qual a reserva o que vence quando é o aporte quais as metas"
        assertEquals(5, Conversa.dividir(f).size)
    }
}
