import { describe,it,expect } from 'vitest';
import fixtures from './fixtures/offers.json';
describe('synthetic offer matching',()=>{
 it('keeps only an exact new, unlocked model and storage match',()=>{
  const matches=fixtures.filter(o=>o.model==='iPhone 17e'&&o.storage===256&&o.condition==='New'&&o.unlocked&&o.currency==='GBP');
  expect(matches).toHaveLength(1);expect(matches[0].totalPrice).toBe(649);
 });
 it('calculates reductions without changing units',()=>{
  const previous=699,current=679,difference=+(current-previous).toFixed(2),percent=+((difference/previous)*100).toFixed(2);
  expect(difference).toBe(-20);expect(percent).toBe(-2.86);
 });
 it('identifies synthetic contract and refurbished offers as excluded',()=>{
  expect(fixtures.filter(o=>o.condition==='Refurbished'||!o.unlocked).map(o=>o.totalPrice)).toEqual([499,25]);
 });
});
