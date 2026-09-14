const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

export const inspectPng = (bytes: Buffer) => {
  if (
    bytes.length < 33 ||
    !bytes.subarray(0, 8).equals(PNG_SIGNATURE) ||
    bytes.toString("ascii", 12, 16) !== "IHDR"
  ) {
    throw new Error("실제 PNG 이미지 파일이 아닙니다.");
  }
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  if (width < 1 || height < 1 || width > 4096 || height > 4096) {
    throw new Error("PNG 크기는 가로·세로 각각 1~4096px까지 지원합니다.");
  }
  const colorType = bytes[25];
  const hasAlpha = colorType === 4 || colorType === 6 || bytes.includes(Buffer.from("tRNS"));
  return { width, height, hasAlpha };
};
