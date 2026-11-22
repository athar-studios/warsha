export interface ActionDef {
  id: string;
  labelKey: string;
  effect: 'rpc' | 'nav' | 'state';
  rpc?: string[];
  route?: string;
  capability?: string;
}
