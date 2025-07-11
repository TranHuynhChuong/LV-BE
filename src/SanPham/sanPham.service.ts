import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { SanPhamRepository } from './sanPham.repository';
import { TransformService } from '../Util/transform.service';
import { SanPham, AnhSP, LichSuThaoTacSP } from './sanPham.schema';
import { CloudinaryService } from 'src/Util/cloudinary.service';
import { CreateDto, UpdateDto } from './sanPham.dto';
import {
  NhanVienService,
  ThaoTac,
} from 'src/NguoiDung/NhanVien/nhanVien.service';

const folderPrefix = 'Products';

const typeOfChange: Record<string, string> = {
  TL_id: 'Thể loại',
  SP_trangThai: 'Trạng thái',
  SP_ten: 'Tên',
  SP_noiDung: 'Nội dung tóm tắt',
  SP_moTa: 'Mô tả',
  SP_tacGia: 'Tác giả',
  SP_nhaXuaBan: 'Nhà xuất bản',
  SP_ngonNgu: 'Ngôn ngữ',
  SP_nguoiDich: 'Người dịch',
  SP_namXuatBan: 'Năm xuất bản',
  SP_soTrang: 'Số trang',
  SP_isbn: 'ISBN',
  SP_giaBan: 'Giá bán',
  SP_giaNhap: 'Giá nhập',
  SP_tonKho: 'Tồn kho',
  SP_trongLuong: 'Trọng lượng',
  SP_anh: 'Ảnh',
};

@Injectable()
export class SanPhamService {
  constructor(
    private readonly SanPham: SanPhamRepository,
    private readonly Transform: TransformService,
    private readonly Cloudinary: CloudinaryService,
    private readonly NhanVien: NhanVienService
  ) {}

  async create(
    data: CreateDto,
    coverImage?: Express.Multer.File,
    Images?: Express.Multer.File[]
  ): Promise<SanPham> {
    // Tạo vector embedding
    const vector = await this.Transform.getTextEmbedding(data.SP_noiDung);

    // Lấy id mới cho sản phẩm
    const lastId = await this.SanPham.findLastId();
    const nextId = lastId + 1;

    // Mảng ảnh sản phẩm
    const images: AnhSP[] = [];

    // Upload ảnh bìa
    if (!coverImage) {
      throw new BadRequestException();
    }

    const { uploaded } = await this.Cloudinary.uploadSingleImage(
      nextId.toString(),
      coverImage,
      folderPrefix
    );

    images.push({
      A_anhBia: true,
      A_publicId: uploaded.public_id,
      A_url: uploaded.url,
    });

    // Upload nhiều ảnh thường - có thể có hoặc không
    if (Images && Images.length > 0) {
      const { uploaded } = await this.Cloudinary.uploadMultipleImages(
        nextId.toString(),
        Images,
        folderPrefix
      );

      // uploaded là mảng các ảnh trả về
      for (const img of uploaded) {
        images.push({
          A_anhBia: false,
          A_publicId: img.public_id,
          A_url: img.url,
        });
      }
    }

    const thaoTac = {
      thaoTac: 'Tạo mới',
      NV_id: data.NV_id,
      thoiGian: new Date(),
    };

    // Dữ liệu để tạo sản phẩm
    const dataToSave: Partial<SanPham> = {
      ...data,
      SP_id: nextId,
      SP_eNoiDung: vector,
      SP_anh: images,
      lichSuThaoTac: [thaoTac],
    };

    const create = await this.SanPham.create(dataToSave);

    if (!create) {
      throw new BadRequestException();
    }
    return create;
  }

  async update(
    id: number,
    data: UpdateDto,
    coverImage?: Express.Multer.File,
    Images?: Express.Multer.File[]
  ): Promise<SanPham> {
    const existing = await this.SanPham.findById(id);
    if (!existing) throw new NotFoundException('Không tìm thấy sản phẩm');

    const images: AnhSP[] = [];

    // Nếu có nội dung mới => tạo lại vector
    let vector = existing.SP_eNoiDung;
    if (data.SP_noiDung) {
      vector = await this.Transform.getTextEmbedding(data.SP_noiDung);
    }

    // Upload ảnh bìa mới nếu có
    if (coverImage) {
      const { uploaded } = await this.Cloudinary.uploadSingleImage(
        id.toString(),
        coverImage,
        id.toString()
      );

      images.push({
        A_anhBia: true,
        A_publicId: uploaded.public_id,
        A_url: uploaded.url,
      });
    }

    // Upload thêm ảnh thường nếu có
    if (Images?.length) {
      const { uploaded } = await this.Cloudinary.uploadMultipleImages(
        id.toString(),
        Images,
        id.toString()
      );

      for (const img of uploaded) {
        images.push({
          A_anhBia: false,
          A_publicId: img.public_id,
          A_url: img.url,
        });
      }
    }

    // Gộp ảnh cũ + mới (hoặc chỉ mới nếu muốn thay thế)
    const allImages = [...existing.SP_anh, ...images];

    const fieldsChange: string[] = [];
    for (const key of Object.keys(data)) {
      if (data[key] !== undefined && data[key] !== existing[key]) {
        const label = typeOfChange[key] || key;
        fieldsChange.push(label);
      }
    }

    const newLichSuThaoTac = [...existing.lichSuThaoTac];
    if (fieldsChange.length > 0 && data.NV_id) {
      const thaoTac = {
        thaoTac: `Cập nhật: ${fieldsChange.join(', ')}`,
        NV_id: data.NV_id,
        thoiGian: new Date(),
      };
      newLichSuThaoTac.push(thaoTac);
    }

    const updatedData: Partial<SanPham> = {
      ...data,
      SP_eNoiDung: vector,
      ...(images.length > 0 && { SP_anh: allImages }),
      lichSuThaoTac: newLichSuThaoTac,
    };

    const updated = await this.SanPham.update(id, updatedData);
    if (!updated) throw new BadRequestException();

    return updated;
  }

  // Lấy tất cả sản phẩm với phân trang và lọc trạng thái
  async findAll(
    page: number,
    limit: number,
    filterType: 1 | 2 | 12 = 12
  ): Promise<{ data: SanPham[]; total: number }> {
    return this.SanPham.findAll(page, limit, filterType);
  }

  // Tìm sản phẩm theo tên (text search)
  async findByName(keyword: string, limit: number, page: number) {
    return this.SanPham.findByName(keyword, page, limit);
  }

  // Tìm sản phẩm tương tự theo embedding vector
  async findByVector(queryText: string, limit: number) {
    const queryVector = await this.Transform.getTextEmbedding(queryText);
    return this.SanPham.findByVector(queryVector, limit);
  }

  async findById(id: number): Promise<any> {
    const result: any = await this.SanPham.findById(id);
    if (!result) {
      throw new NotFoundException();
    }
    if (Array.isArray(result.lichSuThaoTacNV)) {
      result.lichSuThaoTac = await Promise.all(
        result.lichSuThaoTac.map(
          async (element: LichSuThaoTacSP): Promise<ThaoTac> => {
            const nhanVien = await this.NhanVien.findById(element.NV_id);
            const thaoTac: ThaoTac = {
              thaoTac: element.thaoTac,
              thoiGian: element.thoiGian,
              nhanVien: {
                NV_id: null,
                NV_hoTen: null,
                NV_email: null,
                NV_soDienThoai: null,
              },
            };
            if (nhanVien) {
              result.nhanVien = {
                NV_id: nhanVien.NV_id,
                NV_hoTen: nhanVien.NV_hoTen,
                NV_email: nhanVien.NV_email,
                NV_soDienThoai: nhanVien.NV_soDienThoai,
              };
            }
            return thaoTac;
          }
        )
      );
    }
    return result;
  }

  async delete(id: number): Promise<SanPham> {
    const deleted = await this.SanPham.delete(id);
    if (!deleted) {
      throw new NotFoundException(`Không tìm thấy sản phẩm với SP_id = ${id}`);
    }
    return deleted;
  }

  async countAll(): Promise<number> {
    return this.SanPham.countAll();
  }
}
