// Controle de idempotencia dos consumidores.
//
// O RabbitMQ garante entrega "ao menos uma vez": a mesma mensagem pode chegar
// duas vezes. Como o participante da Saga executa efeitos colaterais reais
// (cobrar, estornar), a desduplicacao precisa ser DURAVEL - em memoria ela se
// perderia no restart do pod.
export default interface MensagemProcessadaRepository {
  jaProcessada(mensagemId: string): Promise<boolean>;
  registrar(dados: {
    mensagemId: string;
    tipo: string;
    sagaId?: string;
  }): Promise<void>;
}
