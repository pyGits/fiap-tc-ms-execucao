import TelemetriaGateway, { ResultadoComando } from "../TelemetriaGateway";

export default class TelemetriaGatewayMemoria implements TelemetriaGateway {
  readonly comandos: Array<{ comando: string; resultado: ResultadoComando }> = [];
  readonly enfileiramentos: string[] = [];
  readonly finalizacoes: string[] = [];
  readonly cancelamentos: Array<{ execucaoId: string; compensado: boolean }> = [];
  readonly falhasIntegracao: string[] = [];

  registrarComando(dados: {
    comando: string;
    resultado: ResultadoComando;
  }): void {
    this.comandos.push({ comando: dados.comando, resultado: dados.resultado });
  }

  registrarEnfileiramento(dados: { execucaoId: string }): void {
    this.enfileiramentos.push(dados.execucaoId);
  }

  registrarFinalizacao(dados: { execucaoId: string }): void {
    this.finalizacoes.push(dados.execucaoId);
  }

  registrarCancelamento(dados: {
    execucaoId: string;
    compensado: boolean;
  }): void {
    this.cancelamentos.push({
      execucaoId: dados.execucaoId,
      compensado: dados.compensado,
    });
  }

  registrarFalhaIntegracao(dados: { integracao: string }): void {
    this.falhasIntegracao.push(dados.integracao);
  }

  limpar() {
    this.comandos.length = 0;
    this.enfileiramentos.length = 0;
    this.finalizacoes.length = 0;
    this.cancelamentos.length = 0;
    this.falhasIntegracao.length = 0;
  }
}
