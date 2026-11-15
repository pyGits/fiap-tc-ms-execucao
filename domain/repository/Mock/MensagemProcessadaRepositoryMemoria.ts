import MensagemProcessadaRepository from "../MensagemProcessadaRepository";

export default class MensagemProcessadaRepositoryMemoria
  implements MensagemProcessadaRepository
{
  private readonly registros = new Map<string, { tipo: string; sagaId?: string }>();

  async jaProcessada(mensagemId: string): Promise<boolean> {
    return this.registros.has(mensagemId);
  }

  async registrar(dados: {
    mensagemId: string;
    tipo: string;
    sagaId?: string;
  }): Promise<void> {
    this.registros.set(dados.mensagemId, {
      tipo: dados.tipo,
      sagaId: dados.sagaId,
    });
  }

  limpar() {
    this.registros.clear();
  }
}
