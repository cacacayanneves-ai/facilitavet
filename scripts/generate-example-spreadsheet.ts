import ExcelJS from 'exceljs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Gera a planilha de exemplo oferecida na tela de importação.
 *
 * Modelada no formato real de carteira que os clientes já usam (uma linha
 * por veterinário, abas FIXOS / VARI 1 / VARI 2, frequência de visita em
 * texto livre) — é o exemplo que evita o usuário ter que adivinhar como
 * transformar a própria planilha.
 *
 * Roda uma vez em dev (`npm run example:spreadsheet`) e o resultado fica
 * versionado em `public/`; não precisa gerar em runtime.
 */
async function main() {
  const workbook = new ExcelJS.Workbook();

  const readme = workbook.addWorksheet('Leia-me');
  readme.getColumn(1).width = 110;
  readme.getCell('A1').value =
    'Uma linha por veterinário. A categoria vem do nome da aba: FIXOS, VARI 1 e VARI 2. ' +
    'FREQUENCIA DE VISITA em texto livre: "1x no mês", "2x no mês em dias alternados" (plantão), "1x no mês sempre sexta", ' +
    '"terça ou quinta", "de preferencia quarta", "evitar as sextas". Frequência vazia = fora do mês. ' +
    'Na coluna VISITEI, "colocar dia 16 de outubro" marca a data da visita. No endereço, "NÃO COLOCAR NO ROTEIRO" deixa a clínica fora do roteiro.';

  type Row = [string, string, string, string, string, string];
  const sheets: Array<{ name: string; rows: Row[] }> = [
    {
      name: 'FIXOS',
      rows: [
        ['Dra. Ana Souza', 'CENTRO', 'SET OK', 'CLÍNICA PATA FELIZ', 'Rua das Flores, 120 - Centro, Rio de Janeiro - RJ', '1x no mês'],
        ['Dr. Bruno Lima', 'CENTRO', 'SET OK', 'CLÍNICA PATA FELIZ', 'Rua das Flores, 120 - Centro, Rio de Janeiro - RJ', '1x no mês'],
        ['Dra. Carla Nunes', 'VILA NOVA', '', 'HOSPITAL SÃO FRANCISCO', 'Av. Brasil, 4500 - Vila Nova, Rio de Janeiro - RJ', '2x no mês em dias alternados'],
        ['Dr. Diego Alves', 'VILA NOVA', '', 'HOSPITAL SÃO FRANCISCO', 'Av. Brasil, 4500 - Vila Nova, Rio de Janeiro - RJ', '2x no mês em dias alternados'],
      ],
    },
    {
      name: 'VARI 1',
      rows: [
        ['Dra. Elisa Prado', 'BOA VISTA', 'colocar dia 16 de outubro', 'VET AMIGO FIEL', 'Rua do Sol, 45 - Boa Vista, Rio de Janeiro - RJ', '1x no mês sempre sexta'],
        ['Dr. Fábio Rocha', 'CENTRO', '', 'CLÍNICA BICHO MANSO', 'Rua Sete, 300 - Centro, Rio de Janeiro - RJ', '1x no mês terça ou quinta'],
      ],
    },
    {
      name: 'VARI 2',
      rows: [
        ['Dra. Gabriela Reis', 'NOVO BAIRRO', '', 'PET CENTER 24H', 'Rua Nova, 10 - Novo Bairro, Rio de Janeiro - RJ', '1x no mês de preferencia quarta'],
        ['Dr. Henrique Dias', 'CENTRO', '', 'DOMICILIO', 'veterinário que faço visita online, NÃO COLOCAR NO ROTEIRO', ''],
      ],
    },
  ];

  for (const sheet of sheets) {
    const ws = workbook.addWorksheet(sheet.name);
    ws.columns = [
      { header: 'NOME', key: 'nome', width: 24 },
      { header: 'BAIRRO', key: 'bairro', width: 14 },
      { header: 'VISITEI', key: 'visitei', width: 26 },
      { header: 'DE ONDE', key: 'onde', width: 26 },
      { header: 'ENDEREÇO', key: 'endereco', width: 52 },
      { header: 'FREQUENCIA DE VISITA', key: 'frequencia', width: 34 },
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
