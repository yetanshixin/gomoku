# -*- coding: utf-8 -*-
"""五子棋终结者地毯谱 LZMA 变体解码器（完整版）

数据：五子棋终结者.exe 资源 ID 0x88 / 类型 0x17，文件偏移 0x1be70，39132 字节。
头部 5 字节：byte[0]=93(lc=3,lp=0,pb=2)，byte[1..4]=code 大端。

关键参数（与标准 LZMA 的差异）：
- dist 是 1-based（+1）
- 非 rep state = 7/10（非 0/3）
- rep1/2/3 初始 = 1，rep0 = 0
- 概率初始 1024
- **归一化时机：在每个 bit 解码【前】归一化（thr 之前），而非标准 LZMA 的判定后**
  （这是关键：direct bits 结束后 range < 0x1000000，若按标准 LZMA 判定后归一化，
    thr 会用未归一化的 range，导致 code/range 漂移）
"""
import sys, struct

IS_MATCH=0; IS_REP=192; IS_REP_G0=204; IS_REP_G1=216; IS_REP_G2=228; IS_REP0_LONG=240
POS_SLOT=432; SPEC_POS=688; ALIGN=802; LEN=818; REP_LEN=1332; LITERAL=1846; NPROBS=7990


def decode(data, target=0x2a6bb):
    """解压地毯谱数据，返回字节列表（值序列）。data 是 39132 字节的资源数据。"""
    probs = [1024] * NPROBS
    range_ = 0xFFFFFFFF
    code = int.from_bytes(data[1:5], 'big')
    pos = 5
    state = 0
    rep0, rep1, rep2, rep3 = 0, 1, 1, 1
    dic = []

    def rb():
        return data[pos] if pos < len(data) else 0

    def db(idx):
        nonlocal range_, code, pos
        # 归一化必须在 thr 计算【前】（五子棋终结者的变体）
        while range_ < 0x1000000:
            range_ = (range_ << 8) & 0xFFFFFFFF
            code = ((code << 8) | rb()) & 0xFFFFFFFF
            pos += 1
        p = probs[idx]
        thr = (range_ >> 11) * p
        if code < thr:
            range_ = thr
            probs[idx] = p + ((0x800 - p) >> 5)
            b = 0
        else:
            code -= thr
            range_ -= thr
            probs[idx] = p - (p >> 5)
            b = 1
        return b

    def dbits(n):
        nonlocal range_, code, pos
        r = 0
        for _ in range(n):
            while range_ < 0x1000000:
                range_ = (range_ << 8) & 0xFFFFFFFF
                code = ((code << 8) | rb()) & 0xFFFFFFFF
                pos += 1
            range_ = (range_ >> 1) & 0xFFFFFFFF
            code = (code - range_) & 0xFFFFFFFF
            t = code >> 31
            if t == 1:
                code = (code + range_) & 0xFFFFFFFF
            r = (r << 1) | (1 - t)
        return r

    def bt(base, n):
        s = 1
        for _ in range(n):
            s = (s << 1) | db(base + s)
        return s - (1 << n)

    def rbt(base, n):
        m = 1
        s = 0
        for i in range(n):
            b = db(base + m)
            m = (m << 1) | b
            s |= b << i
        return s

    def lend(base, ps):
        if db(base) == 0:
            return bt(base + 2 + ps * 8, 3)
        if db(base + 1) == 0:
            return bt(base + 130 + ps * 8, 3) + 8
        return bt(base + 258, 8) + 16

    while len(dic) < target:
        ps = len(dic) & 3
        if db(IS_MATCH + (state << 4) + ps) == 0:
            # literal
            ctx = (dic[-1] >> 5) if dic else 0
            base = LITERAL + ctx * 768
            if state < 7:
                s = 1
                while s < 0x100:
                    s = (s << 1) | db(base + s)
                b = s - 0x100
                state = 0 if state < 4 else state - 3
            else:
                # matched literal
                mb = dic[-rep0] if 0 < rep0 <= len(dic) else 0
                offs = 0x100
                state = state - (3 if state < 10 else 6)
                s = 1
                while s < 0x100:
                    mb = (mb << 1) & 0x1FF
                    bit = offs & mb
                    b = db(base + offs + bit + s)
                    if b == 0:
                        offs &= ~bit
                        s = s << 1
                    else:
                        offs &= bit
                        s = (s << 1) + 1
                b = s - 0x100
            dic.append(b)
        else:
            # match
            if db(IS_REP + state) == 0:
                # 非 rep
                state = 7 if state < 7 else 10
                ln = lend(LEN, ps) + 2
                lt = min(ln - 2, 3)
                psl = bt(POS_SLOT + lt * 64, 6)
                if psl < 4:
                    dist = psl + 1
                else:
                    nb = (psl >> 1) - 1
                    if psl < 14:
                        d = (2 | (psl & 1)) << nb
                        d += rbt(SPEC_POS + d - psl - 1, nb)
                    else:
                        d = (2 | (psl & 1))
                        d = (d << (nb - 4)) + dbits(nb - 4)
                        d = (d << 4) + rbt(ALIGN, 4)
                    dist = d + 1
                rep3, rep2, rep1, rep0 = rep2, rep1, rep0, dist
            else:
                # rep match
                if db(IS_REP_G0 + state) == 0:
                    if db(IS_REP0_LONG + (state << 4) + ps) == 0:
                        dist = rep0
                        ln = 1
                        state = 9 if state < 7 else 11
                    else:
                        dist = rep0
                        ln = lend(REP_LEN, ps) + 2
                        state = 8 if state < 7 else 11
                else:
                    if db(IS_REP_G1 + state) == 0:
                        dist = rep1
                    else:
                        if db(IS_REP_G2 + state) == 0:
                            dist = rep2
                        else:
                            dist = rep3
                            rep3 = rep2
                        rep2 = rep1
                    rep1 = rep0
                    rep0 = dist
                    ln = lend(REP_LEN, ps) + 2
                    state = 8 if state < 7 else 11
            for _ in range(ln):
                dic.append(dic[-dist])
    return dic


def to_text(values):
    """值序列 → 括号文本。14='['，15=']'，其他='('+坐标。"""
    def dis(v):
        return chr((v - 1) // 16 + ord('0')) + chr((v - 1) % 16 + ord('1'))
    out = []
    for b in values:
        if b == 14:
            out.append('[')
        elif b == 15:
            out.append(']')
        else:
            out.append('(' + dis(b))
    return ''.join(out)


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    exe = open('五子棋终结者.exe', 'rb').read()
    carpet = exe[0x1be70:0x1be70 + 39132]
    values = decode(carpet)
    text = to_text(values)
    open('carpet_text.txt', 'w', encoding='utf-8').write(text)
    print('值序列长度 =', len(values))
    print('坐标节点数 =', sum(1 for b in values if b not in (14, 15)))
    print('括号文本大小 =', len(text))
    print('开头 60 字符:', text[:60])
    print('结尾 60 字符:', text[-60:])
