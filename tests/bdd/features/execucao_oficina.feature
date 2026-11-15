# language: pt

Funcionalidade: Participacao da Execucao na Saga e operacao da oficina
  Como oficina mecanica
  Quero que a fila de servicos aceite, recuse e devolva vagas de forma previsivel
  Para que nenhum carro ocupe a oficina sem ordem de servico consistente

  Contexto:
    Dado um comando da Saga "saga-1" para a ordem de servico "os-1"

  @enfileiramento @caminho-feliz
  Cenario: Oficina aceita o servico e informa a posicao na fila
    Quando o orquestrador envia o comando para enfileirar a execucao com os itens:
      | item            | descricao        | quantidade | tipo    |
      | srv-revisao     | Revisao completa | 1          | SERVICO |
      | pec-filtro-oleo | Filtro de oleo   | 2          | PECA    |
    Entao a Execucao deve responder "EXECUCAO_ENFILEIRADA"
    E a execucao deve estar na posicao 1 da fila
    E o tempo estimado da execucao deve ser 90 minutos
    E a execucao deve estar com o status "NA_FILA"

  @enfileiramento @idempotencia
  Cenario: Comando reentregue nao ocupa duas vagas da oficina
    Dado que a execucao da Saga ja foi enfileirada
    Quando o orquestrador reenvia o mesmo comando de enfileirar a execucao
    Entao deve existir apenas 1 execucao na oficina
    E a Execucao deve responder "EXECUCAO_ENFILEIRADA"

  @enfileiramento @falha @rollback
  Cenario: Fila cheia e uma recusa de negocio que dispara o rollback da Saga
    Dado que a oficina esta com a capacidade esgotada
    Quando o orquestrador envia o comando para enfileirar a execucao
    Entao a Execucao deve responder "EXECUCAO_FALHOU"
    E o motivo da recusa deve mencionar "Fila da oficina cheia"
    E nao deve existir execucao para a ordem de servico

  @enfileiramento @falha @rollback @demonstracao
  Cenario: Falha simulada no ultimo passo da Saga
    Quando o orquestrador envia o comando para enfileirar a execucao com falha simulada
    Entao a Execucao deve responder "EXECUCAO_FALHOU"
    E o codigo da recusa deve ser "execucao.falha.simulada"
    E nao deve existir execucao para a ordem de servico

  @compensacao
  Cenario: Compensacao devolve a vaga enquanto o carro ainda espera
    Dado que a execucao da Saga ja foi enfileirada
    Quando o orquestrador envia a compensacao para cancelar a execucao por "Pagamento estornado"
    Entao a Execucao deve responder "EXECUCAO_CANCELADA"
    E a compensacao deve ser confirmada como concluida
    E a execucao deve estar com o status "CANCELADA"
    E a oficina deve ter 0 vaga ocupada

  @compensacao @idempotencia
  Cenario: Compensacao repetida mantem o motivo original
    Dado que a execucao da Saga ja foi enfileirada
    Quando o orquestrador envia a compensacao para cancelar a execucao por "Pagamento estornado"
    E o orquestrador reenvia a compensacao para cancelar a execucao por "Outro motivo"
    Entao o motivo registrado na execucao deve ser "Pagamento estornado"

  @compensacao @limite
  Cenario: Reparo concluido nao pode ser desfeito pela compensacao
    Dado que a execucao da Saga ja foi enfileirada
    E que o mecanico "Joao da Silva" iniciou o reparo
    E que o mecanico finalizou o reparo
    Quando o orquestrador envia a compensacao para cancelar a execucao por "Rollback tardio"
    Entao a Execucao deve responder "EXECUCAO_CANCELADA"
    E a compensacao deve ser sinalizada como impossivel
    E a execucao deve estar com o status "FINALIZADA"

  @compensacao @tolerancia
  Cenario: Compensacao de algo que nunca foi enfileirado nao falha
    Quando o orquestrador envia a compensacao para cancelar a execucao por "Falha antes da execucao"
    Entao a Execucao deve responder "EXECUCAO_CANCELADA"
    E a compensacao deve ser confirmada como concluida

  @operacao @coreografia
  Cenario: Reparo finalizado publica o evento que o OS Service escuta
    Dado que a execucao da Saga ja foi enfileirada
    E que o mecanico "Joao da Silva" iniciou o reparo
    Quando o mecanico finaliza o reparo com a observacao "Revisao concluida"
    Entao a Execucao deve responder "EXECUCAO_FINALIZADA"
    E a execucao deve estar com o status "FINALIZADA"
    E todos os servicos da execucao devem estar concluidos
    E a oficina deve ter 0 vaga ocupada
