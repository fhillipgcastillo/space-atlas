import { describe, expect, it } from 'vitest';
import { modeledNoticeText } from './modeledNotice.js';

describe('modeledNoticeText', () => {
  it('says plainly that the field is not measured', () => {
    const text = modeledNoticeText(0.98);
    expect(text.toLowerCase()).toContain('modeled');
    expect(text.toLowerCase()).not.toContain('measured data');
  });

  it('reports the proportion so the viewer knows how much is invented', () => {
    expect(modeledNoticeText(0.98)).toContain('98%');
    expect(modeledNoticeText(0.5)).toContain('50%');
  });

  it('rounds rather than showing false precision', () => {
    expect(modeledNoticeText(0.9812345)).toContain('98%');
  });

  it('clamps out-of-range input', () => {
    expect(modeledNoticeText(1.4)).toContain('100%');
    expect(modeledNoticeText(-0.2)).toContain('0%');
  });

  it('does not round a layer that still holds measurements up to 100%', () => {
    expect(modeledNoticeText(0.9994168)).toContain('99%');
    expect(modeledNoticeText(1)).toContain('100%');
  });

  it('says the field cannot be hovered or searched', () => {
    const text = modeledNoticeText(0.99).toLowerCase();
    expect(text).toContain('hovered');
    expect(text).toContain('searched');
  });
});
