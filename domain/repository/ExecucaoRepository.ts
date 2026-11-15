import Execucao, { StatusExecucao } from "../entity/Execucao";

export type FiltroExecucao = {
  status?: StatusExecucao;
  veiculoId?: string;
};

export default interface ExecucaoRepository {
  salvar(execucao: Execucao): Promise<void>;
  atualizar(execucao: Execucao): Promise<void>;
  obter(id: string): Promise<Execucao | null>;
  obterPorOrdemServico(ordemServicoId: string): Promise<Execucao | null>;
  obterPorSaga(sagaId: string): Promise<Execucao | null>;
  listar(filtro?: FiltroExecucao): Promise<Execucao[]>;
  // Tamanho atual da fila: define a posicao da proxima execucao aceita.
  contarNaFila(): Promise<number>;
}
