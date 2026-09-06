import ExcelJS from 'exceljs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Gera a planilha de exemplo oferecida na tela de importação.
 *
 * Modelada no formato real de carteira que os clientes já usam (uma linha
 * por veterinário, categoria = nome da aba), não no formato "uma linha por
 * clínica" que o produto aceitava antes — é o exemplo que evita o usuário
 * ter que adivinhar como transformar a própria planilha.
 *
 * Roda uma vez em dev (`npm run example:spreadsheet`) e o resultado fica
 * versionado em `public/`; não precisa gerar em runtime.
 */
async function main() {
  const workbook = new ExcelJS.Workbook();

  const readme = workbook.addWorksheet('Leia-me');
  readme.getColumn(1).width = 100;
  readme.getCell('A1').value =
    'Uma linha por veterinário. A categoria vem do nome da aba (CAT 1, CAT 2, CAT 3) — não precisa de coluna "Categoria". ' +
    'Marque "2 visitas" quando a clínica funciona por plantão e nem todo mundo está presente no mesmo dia, então uma única visita não alcança todos. ' +
    'Se ainda não souber o nome do veterinário de uma clínica nova, deixe a célula em branco: a clínica entra na carteira mesmo assim.';

  const sheets: Array<{ name: string; rows: Array<[string, string, string, string]> }> = [
    {
      name: 'CAT 1',
      rows: [
        ['Clínica Pata Feliz', 'Dra. Ana Souza', 'Centro', ''],
        ['Clínica Pata Feliz', 'Dr. Bruno Lima', 'Centro', ''],
        ['Vet Amigo Fiel', 'Dra. Carla Nunes', 'Jardim das Flores', ''],
      ],
    },
    {
      name: 'CAT 2',
      rows: [
        ['Hospital Veterinário São Francisco', 'Dr. Diego Alves', 'Vila Nova', ''],
        ['Hospital Veterinário São Francisco', 'Dra. Elisa Prado', 'Vila Nova', ''],
        ['Clínica Bicho Manso', 'Dr. Fábio Rocha', 'Centro', ''],
      ],
    },
    {
      name: 'CAT 3',
      rows: [
        ['Pet Center 24h', 'Dra. Gabriela Reis', 'Boa Vista', 'Sim'],
        ['Pet Center 24h', 'Dr. Henrique Dias', 'Boa Vista', 'Sim'],
        // Clínica nova, ainda mapeando quem atende — linha sem veterinário nomeado.
        ['Clínica Novo Bairro', '', 'Novo Bairro', ''],
      ],
    },
  ];

  for (const sheet of sheets) {
    const ws = workbook.addWorksheet(sheet.name);
    ws.columns = [
      { header: 'Clínica', key: 'clinica', width: 34 },
      { header: 'Nome do veterinário', key: 'veterinario', width: 26 },
      { header: 'Bairro', key: 'bairro', width: 20 },
      { header: '2 visitas', key: 'visitas', width: 12 },
    ];
    ws.getRow(1).font = { bold: true };
    for (const row of sheet.rows) ws.addRow(row);
  }

  const outDir = path.join(process.cwd(), 'public');
  await mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, 'exemplo-carteira-facilitavet.xlsx');
  const buffer = await workbook.xlsx.writeBuffer();
  await writeFile(outPath, Buffer.from(buffer));
  console.log(`Planilha de exemplo gerada em ${outPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
