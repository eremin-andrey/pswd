# Рисует иконки приложения (замок) в PNG без сторонних библиотек.
import struct, sys, zlib

def png(size, path):
    bg, fg = (31, 41, 55), (250, 204, 21)
    s = size / 100.0
    def inside(x, y):
        X, Y = x / s, y / s
        if 24 <= X <= 76 and 46 <= Y <= 84:                      # корпус
            hole = ((X - 50) ** 2 + (Y - 60) ** 2 <= 36) or (47 <= X <= 53 and 60 <= Y <= 74)
            return not hole
        d = ((X - 50) ** 2 + (Y - 46) ** 2) ** 0.5              # дужка
        return Y <= 46 and 13 <= d <= 21
    rows = b''.join(b'\0' + b''.join(bytes(fg if inside(x + .5, y + .5) else bg) for x in range(size))
                    for y in range(size))
    def chunk(t, d):
        return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    with open(path, 'wb') as f:
        f.write(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 2, 0, 0, 0))
                + chunk(b'IDAT', zlib.compress(rows, 9)) + chunk(b'IEND', b''))

out = sys.argv[1] if len(sys.argv) > 1 else '.'
for n in (180, 192, 512):
    png(n, f'{out}/icon-{n}.png')
