import { describe, expect, it } from 'vitest';
import { normalizeCategory, suggestColumnMapping } from '@/lib/services/import';

describe('deteccao de colunas da planilha', () => {
  it('reconhece cabecalhos comuns em portugues', () => {
    const mapping = suggestColumnMapping([
      'Nome da Clínica', 'Categoria', 'Endereço', 'Bairro', 'Cidade', 'UF', 'CEP', 'Telefone',
    ]);
    expect(mapping.name).toBe('Nome da Clínica');
    expect(mapping.category).toBe('Categoria');
    expect(mapping.address).toBe('Endereço');
    expect(mapping.neighborhood).toBe('Bairro');
    expect(mapping.city).toBe('Cidade');
    expect(mapping.state).toBe('UF');
    expect(mapping.postalCode).toBe('CEP');
    expect(mapping.phone).toBe('Telefone');
  });

  it('ignora acentuacao, caixa e espacos extras', () => {
    const mapping = suggestColumnMapping(['  NOME  ', 'CAT', 'municipio']);
    expect(mapping.name).toBe('  NOME  ');
    expect(mapping.category).toBe('CAT');
    expect(mapping.city).toBe('municipio');
  });

  it('nao reutiliza a mesma coluna para dois campos', () => {
    const mapping = suggestColumnMapping(['Nome', 'Categoria', 'Bairro']);
    const used = Object.values(mapping);
    expect(new Set(used).size).toBe(used.length);
  });

  it('deixa em branco o que nao reconhece, em vez de chutar', () => {
    const mapping = suggestColumnMapping(['Coluna A', 'Coluna B']);
    expect(mapping.name).toBeUndefined();
    expect(mapping.category).toBeUndefined();
  });

  it('reconhece latitude e longitude com abreviacoes', () => {
    const mapping = suggestColumnMapping(['lat', 'lng', 'nome', 'cat']);
    expect(mapping.latitude).toBe('lat');
    expect(mapping.longitude).toBe('lng');
  });
});

describe('normalizacao de categoria', () => {
  it('aceita as variacoes que aparecem em planilhas reais', () => {
    for (const value of ['1', '01', 'Cat 1', 'CAT1', 'cat  1', 'Categoria 1', 'A']) {
      expect(normalizeCategory(value)).toBe('CAT1');
    }
    for (const value of ['2', 'Cat 2', 'CATEGORIA 2', 'B']) {
      expect(normalizeCategory(value)).toBe('CAT2');
    }
    for (const value of ['3', 'Cat 3', 'cat3', 'C']) {
      expect(normalizeCategory(value)).toBe('CAT3');
    }
  });

  it('recusa valores desconhecidos em vez de adivinhar', () => {
    expect(normalizeCategory('')).toBeNull();
    expect(normalizeCategory('Premium')).toBeNull();
    expect(normalizeCategory('4')).toBeNull();
    expect(normalizeCategory('Cat 9')).toBeNull();
  });
});
