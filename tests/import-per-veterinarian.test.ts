import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { parseSpreadsheet } from '@/lib/services/import';

/**
 * Constroi um XLSX em memoria com uma aba por entrada de `sheets`, cada uma
 * com o cabecalho da planilha real do cliente (secao 8): uma linha por
 * veterinario, categoria = nome da aba.
 */
async function buildWorkbook(
  sheets: Array<{ name: string; header: string[]; rows: string[][] }>,
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  for (const { name, header, rows } of sheets) {
    const sheet = workbook.addWorksheet(name);
    sheet.addRow(header);
    for (const row of rows) sheet.addRow(row);
  }
  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}

const HEADER = ['Nome dos Veterinários', 'CPF', 'BAIRRO', 'CLÍNICAS', '2 VISITAS'];

describe('planilha real: uma linha por veterinario, categoria = aba', () => {
  it('conta veterinarios por clinica e usa o nome da aba como categoria', async () => {
    const buffer = await buildWorkbook([
      {
        name: 'CAT 1',
        header: HEADER,
        rows: [
          ['Ana', '', 'Bangu', 'Clinica Alfa', ''],
          ['Bruno', '', 'Bangu', 'Clinica Alfa', ''],
          ['Carla', '', 'Bangu', 'Clinica Beta', ''],
        ],
      },
      {
        name: 'CAT 2',
        header: HEADER,
        rows: [['Dora', '', 'Campo Grande', 'Clinica Gama', '']],
      },
    ]);

    const result = await parseSpreadsheet('carteira.xlsx', buffer);

    expect(result.rows).toHaveLength(3);
    const alfa = result.rows.find((r) => r['Nome da clínica'] === 'Clinica Alfa');
    expect(alfa?.Categoria).toBe('CAT1');
    expect(alfa?.['Quantidade de veterinários']).toBe('2');
    const gama = result.rows.find((r) => r['Nome da clínica'] === 'Clinica Gama');
    expect(gama?.Categoria).toBe('CAT2');
    expect(gama?.['Quantidade de veterinários']).toBe('1');
  });

  it('trata a coluna de plantao como divisao de visita em 2 partes', async () => {
    const buffer = await buildWorkbook([
      {
        name: 'CAT 1',
        header: HEADER,
        rows: [
          ['Ana', '', 'Bangu', 'Clinica Grande', 'SIM'],
          ['Bruno', '', 'Bangu', 'Clinica Grande', 'SIM'],
          ['Carla', '', 'Bangu', 'Clinica Pequena', ''],
        ],
      },
    ]);

    const result = await parseSpreadsheet('carteira.xlsx', buffer);
    const grande = result.rows.find((r) => r['Nome da clínica'] === 'Clinica Grande');
    const pequena = result.rows.find((r) => r['Nome da clínica'] === 'Clinica Pequena');
    expect(grande?.['Dividir visita em quantas partes']).toBe('2');
    expect(pequena?.['Dividir visita em quantas partes']).toBe('');
  });

  it('mesmo nome em bairros diferentes vira duas clinicas distintas', async () => {
    const buffer = await buildWorkbook([
      {
        name: 'CAT 1',
        header: HEADER,
        rows: [
          ['Ana', '', 'Bangu', 'Central do Animal', ''],
          ['Bruno', '', 'Santa Cruz', 'Central do Animal', ''],
        ],
      },
    ]);

    const result = await parseSpreadsheet('carteira.xlsx', buffer);
    const centrais = result.rows.filter((r) => r['Nome da clínica'] === 'Central do Animal');
    expect(centrais).toHaveLength(2);
    expect(centrais.map((r) => r.Bairro).sort()).toEqual(['Bangu', 'Santa Cruz']);
  });

  it('mesma clinica em duas categorias soma os veterinarios e fica com a categoria majoritaria', async () => {
    const buffer = await buildWorkbook([
      {
        name: 'CAT 1',
        header: HEADER,
        rows: [
          ['Ana', '', 'Campo Grande', 'Cinco Estrelas', ''],
          ['Bruno', '', 'Campo Grande', 'Cinco Estrelas', ''],
          ['Carla', '', 'Campo Grande', 'Cinco Estrelas', ''],
        ],
      },
      {
        name: 'CAT 3',
        header: HEADER,
        rows: [['Dora', '', 'Campo Grande', 'Cinco Estrelas', '']],
      },
    ]);

    const result = await parseSpreadsheet('carteira.xlsx', buffer);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].Categoria).toBe('CAT1');
    expect(result.rows[0]['Quantidade de veterinários']).toBe('4');
    expect(result.notices.some((n) => n.includes('Cinco Estrelas') && n.includes('mantida CAT1'))).toBe(true);
  });

  it('veterinario sem clinica preenchida nao e contado e vira aviso, nao erro silencioso', async () => {
    const buffer = await buildWorkbook([
      {
        name: 'CAT 1',
        header: HEADER,
        rows: [
          ['Ana', '', 'Bangu', 'Clinica Alfa', ''],
          ['Bruno Sem Clinica', '', 'Bangu', '', ''],
        ],
      },
    ]);

    const result = await parseSpreadsheet('carteira.xlsx', buffer);
    expect(result.rows).toHaveLength(1);
    expect(result.notices.some((n) => n.includes('Bruno Sem Clinica'))).toBe(true);
  });

  it('clinica sem nenhum veterinario nomeado entra com 1 e avisa, em vez de sumir da carteira', async () => {
    const buffer = await buildWorkbook([
      {
        name: 'CAT 3',
        header: HEADER,
        rows: [['', '', 'Paciência', 'Clinica Nova', '']],
      },
    ]);

    const result = await parseSpreadsheet('carteira.xlsx', buffer);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]['Quantidade de veterinários']).toBe('1');
    expect(result.notices.some((n) => n.includes('Clinica Nova') && n.includes('sem nenhum veterinário nomeado'))).toBe(true);
  });

  it('quando a clinica ja tem veterinario nomeado em outra aba, a linha pendente e absorvida sem gerar aviso de pendencia', async () => {
    const buffer = await buildWorkbook([
      {
        name: 'CAT 2',
        header: HEADER,
        rows: [
          ['Ana', '', 'Campo Grande', 'Clinica Vet Honorato', ''],
          ['Bruno', '', 'Campo Grande', 'Clinica Vet Honorato', ''],
        ],
      },
      {
        name: 'CAT 3',
        header: HEADER,
        rows: [['', '', 'Campo Grande', 'Clinica Vet Honorato', '']],
      },
    ]);

    const result = await parseSpreadsheet('carteira.xlsx', buffer);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]['Quantidade de veterinários']).toBe('2');
    expect(result.rows[0].Categoria).toBe('CAT2');
    expect(result.notices.some((n) => n.includes('sem nenhum veterinário nomeado'))).toBe(false);
    expect(result.notices.some((n) => n.includes('mais de uma categoria'))).toBe(false);
  });

  it('planilha de uma aba so com coluna de categoria segue o formato padrao (uma linha por clinica)', async () => {
    const buffer = await buildWorkbook([
      {
        name: 'Planilha1',
        header: ['Nome', 'Categoria', 'Bairro'],
        rows: [
          ['Clinica X', 'Cat 1', 'Bangu'],
          ['Clinica Y', 'Cat 2', 'Bangu'],
        ],
      },
    ]);

    const result = await parseSpreadsheet('carteira.xlsx', buffer);
    expect(result.columns).toEqual(['Nome', 'Categoria', 'Bairro']);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0].Categoria).toBe('Cat 1');
    expect(result.notices).toHaveLength(0);
  });
});
