export class NullPosIntegration {
    provider = 'square';
    async pullMenu() {
        return [];
    }
    async pushOrder() {
        return { externalOrderId: 'stub-order' };
    }
}
