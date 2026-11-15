export type ResultadoComando = "CONCLUIDO" | "FALHOU" | "COMPENSADO";

// Observabilidade do servico de Execucao.
//   SagaComandoRecebido  - comandos processados
//   ExecucaoEnfileirada  - tamanho da fila e tempo estimado
//   ExecucaoFinalizada   - tempo real de oficina por OS
//   ExecucaoCancelada    - compensacoes (alerta operacional)
export default interface TelemetriaGateway {
  registrarComando(dados: {
    sagaId: string;
    ordemServicoId: string;
    comando: string;
    resultado: ResultadoComando;
    duracaoMs: number;
    erro?: string;
  }): void;

  registrarEnfileiramento(dados: {
    sagaId: string;
    ordemServicoId: string;
    execucaoId: string;
    posicaoFila: number;
    tempoEstimadoMinutos: number;
  }): void;

  registrarFinalizacao(dados: {
    ordemServicoId: string;
    execucaoId: string;
    duracaoMs: number | null;
    tempoEstimadoMinutos: number;
  }): void;

  registrarCancelamento(dados: {
    sagaId: string;
    ordemServicoId: string;
    execucaoId: string;
    motivo: string;
    compensado: boolean;
  }): void;

  registrarFalhaIntegracao(dados: {
    integracao: string;
    operacao: string;
    erro: string;
  }): void;
}
