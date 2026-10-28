import test from 'node:test';
import assert from 'node:assert/strict';
import {parseNetworks} from './wifi-networks.mjs';
test('network names preserve case and order, hidden SSIDs omitted, mixed bands accepted',()=>{
  assert.deepEqual(parseNetworks('SSID 1 : \n Band : 2.4 GHz\nSSID 2 : ExactCase\n Band : 5 GHz\n Channel : 132\n BSSID 2 : xx\n Band : 2.4 GHz\n Channel : 3\nSSID 3 : Other\n Channel : 48'),[{ssid:'ExactCase',compatible:true},{ssid:'Other',compatible:false}]);
});
test('channel fallback does not mistake channel 132 for 2.4 GHz',()=>{
  assert.deepEqual(parseNetworks('SSID 1 : Five\n Channel : 132\nSSID 2 : Two\n Channel : 11'),[{ssid:'Two',compatible:true},{ssid:'Five',compatible:false}]);
});
