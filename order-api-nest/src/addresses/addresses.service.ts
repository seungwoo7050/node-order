import { Injectable, Logger, Optional } from "@nestjs/common";
import { RuntimeSecretsService } from "../admin/runtime-secrets.service.js";

export interface AddressItem {
  postalCode: string;
  roadAddress: string;
  jibunAddress: string;
  buildingName: string;
}

export const PRESET_ADDRESSES: AddressItem[] = [
  { postalCode: "06236", roadAddress: "서울특별시 강남구 테헤란로 123", jibunAddress: "서울특별시 강남구 역삼동 648-23", buildingName: "테헤란빌딩" },
  { postalCode: "06241", roadAddress: "서울특별시 강남구 테헤란로 152", jibunAddress: "서울특별시 강남구 역삼동 737", buildingName: "강남파이낸스센터" },
  { postalCode: "06164", roadAddress: "서울특별시 강남구 테헤란로 521", jibunAddress: "서울특별시 강남구 삼성동 159-1", buildingName: "파르나스타워" },
  { postalCode: "06028", roadAddress: "서울특별시 강남구 압구정로 201", jibunAddress: "서울특별시 강남구 압구정동 456", buildingName: "현대아파트" },
  { postalCode: "06039", roadAddress: "서울특별시 강남구 강남대로 152", jibunAddress: "서울특별시 강남구 신사동 501", buildingName: "신사빌딩" },
  { postalCode: "04781", roadAddress: "서울특별시 성동구 성수이로 51", jibunAddress: "서울특별시 성동구 성수동2가 315-1", buildingName: "서울숲드림타워" },
  { postalCode: "04779", roadAddress: "서울특별시 성동구 성수이로 22", jibunAddress: "서울특별시 성동구 성수동2가 333-16", buildingName: "성수IT종합센터" },
  { postalCode: "04784", roadAddress: "서울특별시 성동구 아차산로 113", jibunAddress: "서울특별시 성동구 성수동2가 300-1", buildingName: "삼원타워" },
  { postalCode: "04770", roadAddress: "서울특별시 성동구 뚝섬로 273", jibunAddress: "서울특별시 성동구 성수동1가 685-700", buildingName: "트리마제" },
  { postalCode: "06652", roadAddress: "서울특별시 서초구 반포대로 58", jibunAddress: "서울특별시 서초구 서초동 1445-13", buildingName: "서초빌딩" },
  { postalCode: "06593", roadAddress: "서울특별시 서초구 반포대로 201", jibunAddress: "서울특별시 서초구 반포동 59-1", buildingName: "국립중앙도서관" },
  { postalCode: "06708", roadAddress: "서울특별시 서초구 효령로 174", jibunAddress: "서울특별시 서초구 서초동 1485-1", buildingName: "방배아트자이" },
  { postalCode: "03171", roadAddress: "서울특별시 종로구 세종대로 209", jibunAddress: "서울특별시 종로구 세종로 77-6", buildingName: "정부서울청사" },
  { postalCode: "03048", roadAddress: "서울특별시 종로구 청와대로 1", jibunAddress: "서울특별시 종로구 세종로 1", buildingName: "청와대" },
  { postalCode: "03186", roadAddress: "서울특별시 종로구 종로 1", jibunAddress: "서울특별시 종로구 종로1가 1", buildingName: "교보생명빌딩" },
  { postalCode: "03163", roadAddress: "서울특별시 종로구 인사동길 12", jibunAddress: "서울특별시 종로구 인사동 194-4", buildingName: "인사아트센터" },
  { postalCode: "04524", roadAddress: "서울특별시 중구 세종대로 110", jibunAddress: "서울특별시 중구 태평로1가 31", buildingName: "서울특별시청" },
  { postalCode: "04533", roadAddress: "서울특별시 중구 을지로 100", jibunAddress: "서울특별시 중구 을지로2가 203", buildingName: "파인에비뉴" },
  { postalCode: "04551", roadAddress: "서울특별시 중구 퇴계로 173", jibunAddress: "서울특별시 중구 충무로3가 60-1", buildingName: "남산스퀘어" },
  { postalCode: "04383", roadAddress: "서울특별시 용산구 이태원로 29", jibunAddress: "서울특별시 용산구 용산동3가 1", buildingName: "전쟁기념관" },
  { postalCode: "04352", roadAddress: "서울특별시 용산구 한강대로 405", jibunAddress: "서울특별시 용산구 동자동 43-205", buildingName: "서울역" },
  { postalCode: "04043", roadAddress: "서울특별시 마포구 양화로 160", jibunAddress: "서울특별시 마포구 동교동 165-8", buildingName: "홍대입구역빌딩" },
  { postalCode: "03924", roadAddress: "서울특별시 마포구 월드컵북로 396", jibunAddress: "서울특별시 마포구 상암동 1605", buildingName: "누리꿈스퀘어" },
  { postalCode: "07320", roadAddress: "서울특별시 영등포구 여의대로 108", jibunAddress: "서울특별시 영등포구 여의도동 22", buildingName: "파크원타워" },
  { postalCode: "07326", roadAddress: "서울특별시 영등포구 국제금융로 10", jibunAddress: "서울특별시 영등포구 여의도동 23", buildingName: "IFC서울" },
  { postalCode: "07241", roadAddress: "서울특별시 영등포구 경인로 846", jibunAddress: "서울특별시 영등포구 영등포동4가 442", buildingName: "타임스퀘어" },
  { postalCode: "05551", roadAddress: "서울특별시 송파구 올림픽로 300", jibunAddress: "서울특별시 송파구 신천동 29", buildingName: "롯데월드타워" },
  { postalCode: "05540", roadAddress: "서울특별시 송파구 올림픽로 240", jibunAddress: "서울특별시 송파구 잠실동 40-1", buildingName: "롯데월드" },
  { postalCode: "13529", roadAddress: "경기도 성남시 분당구 판교역로 4", jibunAddress: "경기도 성남시 분당구 백현동 542", buildingName: "판교알파리움" },
  { postalCode: "13494", roadAddress: "경기도 성남시 분당구 판교역로 146", jibunAddress: "경기도 성남시 분당구 백현동 532", buildingName: "판교크래프톤타워" },
  { postalCode: "13487", roadAddress: "경기도 성남시 분당구 판교역로 235", jibunAddress: "경기도 성남시 분당구 삼평동 681", buildingName: "에이치스퀘어" },
  { postalCode: "13486", roadAddress: "경기도 성남시 분당구 판교역로 240", jibunAddress: "경기도 성남시 분당구 삼평동 678", buildingName: "삼환하이펙스" },
  { postalCode: "13488", roadAddress: "경기도 성남시 분당구 대왕판교로 645", jibunAddress: "경기도 성남시 분당구 삼평동 629", buildingName: "경기창조경제혁신센터" },
  { postalCode: "13557", roadAddress: "경기도 성남시 분당구 성남대로 407", jibunAddress: "경기도 성남시 분당구 정자동 178-1", buildingName: "네이버그린팩토리" },
  { postalCode: "16499", roadAddress: "경기도 수원시 팔달구 효원로 241", jibunAddress: "경기도 수원시 팔달구 인계동 1111", buildingName: "수원시청" },
  { postalCode: "16677", roadAddress: "경기도 수원시 영통구 삼성로 129", jibunAddress: "경기도 수원시 영통구 매탄동 416", buildingName: "삼성전자본관" },
  { postalCode: "48058", roadAddress: "부산광역시 해운대구 센텀중앙로 55", jibunAddress: "부산광역시 해운대구 우동 1466-2", buildingName: "센텀다임" },
  { postalCode: "48059", roadAddress: "부산광역시 해운대구 센텀중앙로 78", jibunAddress: "부산광역시 해운대구 우동 1464", buildingName: "센텀그린타워" },
  { postalCode: "48060", roadAddress: "부산광역시 해운대구 APEC로 55", jibunAddress: "부산광역시 해운대구 우동 1414", buildingName: "벡스코" },
  { postalCode: "48099", roadAddress: "부산광역시 해운대구 달맞이길 30", jibunAddress: "부산광역시 해운대구 중동 1058-2", buildingName: "엘시티랜드마크타워" },
  { postalCode: "47545", roadAddress: "부산광역시 연제구 중앙대로 1001", jibunAddress: "부산광역시 연제구 연산동 1000", buildingName: "부산광역시청" },
  { postalCode: "41911", roadAddress: "대구광역시 중구 공평로 88", jibunAddress: "대구광역시 중구 동인동1가 219", buildingName: "대구광역시청" },
  { postalCode: "41585", roadAddress: "대구광역시 북구 대학로 80", jibunAddress: "대구광역시 북구 산격동 1370-1", buildingName: "경북대학교" },
  { postalCode: "21554", roadAddress: "인천광역시 남동구 정각로 29", jibunAddress: "인천광역시 남동구 구월동 1138", buildingName: "인천광역시청" },
  { postalCode: "21998", roadAddress: "인천광역시 연수구 송도과학로 32", jibunAddress: "인천광역시 연수구 송도동 172-1", buildingName: "송도테크노파크" },
  { postalCode: "61945", roadAddress: "광주광역시 서구 내방로 111", jibunAddress: "광주광역시 서구 치평동 1200", buildingName: "광주광역시청" },
  { postalCode: "35242", roadAddress: "대전광역시 서구 둔산로 100", jibunAddress: "대전광역시 서구 둔산동 1420", buildingName: "대전광역시청" },
  { postalCode: "34141", roadAddress: "대전광역시 유성구 대학로 291", jibunAddress: "대전광역시 유성구 구성동 373-1", buildingName: "KAIST본원" },
  { postalCode: "44675", roadAddress: "울산광역시 남구 중앙로 201", jibunAddress: "울산광역시 남구 신정동 646-4", buildingName: "울산광역시청" },
  { postalCode: "30151", roadAddress: "세종특별자치시 한누리대로 411", jibunAddress: "세종특별자치시 어진동 539", buildingName: "정부세종청사" },
  { postalCode: "24266", roadAddress: "강원특별자치도 춘천시 중앙로 1", jibunAddress: "강원특별자치도 춘천시 봉의동 15", buildingName: "강원특별자치도청" },
  { postalCode: "28515", roadAddress: "충청북도 청주시 상당구 상당로 82", jibunAddress: "충청북도 청주시 상당구 문화동 89", buildingName: "충청북도청" },
  { postalCode: "32255", roadAddress: "충청남도 홍성군 홍북읍 충남대로 21", jibunAddress: "충청남도 홍성군 홍북읍 신경리 538", buildingName: "충청남도청" },
  { postalCode: "54994", roadAddress: "전북특별자치도 전주시 완산구 효자로 225", jibunAddress: "전북특별자치도 전주시 완산구 효자동3가 1", buildingName: "전북특별자치도청" },
  { postalCode: "58564", roadAddress: "전라남도 무안군 삼향읍 후광대로 1", jibunAddress: "전라남도 무안군 삼향읍 남악리 1000", buildingName: "전라남도청" },
  { postalCode: "36759", roadAddress: "경상북도 안동시 풍천면 도청대로 455", jibunAddress: "경상북도 안동시 풍천면 갈전리 1420", buildingName: "경상북도청" },
  { postalCode: "51154", roadAddress: "경상남도 창원시 의창구 중앙대로 300", jibunAddress: "경상남도 창원시 의창구 사림동 1", buildingName: "경상남도청" },
  { postalCode: "63122", roadAddress: "제주특별자치도 제주시 문연로 6", jibunAddress: "제주특별자치도 제주시 연동 312-2", buildingName: "제주특별자치도청" },
];

@Injectable()
export class AddressesService {
  private readonly logger = new Logger(AddressesService.name);

  constructor(@Optional() private readonly secrets?: RuntimeSecretsService) {}

  async search(query: string): Promise<{ items: AddressItem[] }> {
    const q = query.trim();
    if (!q) return { items: [] };

    const apiKey = this.secrets?.isPausedPaidApis()
      ? undefined
      : (this.secrets?.getSecret("JUSO_API_KEY") ?? process.env.JUSO_API_KEY);
    if (apiKey) {
      try {
        const url = `https://business.juso.go.kr/addrlink/addrLinkApi.do?confmKey=${encodeURIComponent(apiKey)}&currentPage=1&countPerPage=15&keyword=${encodeURIComponent(q)}&resultType=json`;
        const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
        if (res.ok) {
          const data = (await res.json()) as { results?: { common?: { errorCode?: string }; juso?: { zipNo: string; roadAddr: string; jibunAddr: string; bdNm: string }[] } };
          if (data.results?.common?.errorCode === "0" && Array.isArray(data.results.juso)) {
            const items = data.results.juso.map((j) => ({
              postalCode: j.zipNo,
              roadAddress: j.roadAddr,
              jibunAddress: j.jibunAddr,
              buildingName: j.bdNm || "",
            }));
            return { items };
          }
        }
      } catch (err) {
        this.logger.warn(`행안부 도로명주소 API 호출 실패(${q}), 내장 사전으로 대체: ${(err as Error).message}`);
      }
    }

    // 내장 주소 사전에서 검색 (검색어 띄어쓰기 토큰 매칭)
    const tokens = q.toLowerCase().split(/\s+/).filter(Boolean);
    const matched = PRESET_ADDRESSES.filter((addr) => {
      const full = `${addr.postalCode} ${addr.roadAddress} ${addr.jibunAddress} ${addr.buildingName}`.toLowerCase();
      return tokens.every((token) => full.includes(token));
    });

    return { items: matched.slice(0, 20) };
  }
}
